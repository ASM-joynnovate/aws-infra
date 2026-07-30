import pulumi
import pulumi_aws as aws
import pulumi_cloudflare as cloudflare

CLOUDFRONT_CERTIFICATE_REGION = "us-east-1"
TLS_POLICY = "ELBSecurityPolicy-TLS13-1-2-2021-06"
VALIDATION_RECORD_TTL = 60


class Serving(pulumi.ComponentResource):
    def __init__(
        self,
        name,
        domain,
        zone_id,
        subnets,
        alb_security_group,
        log_bucket,
        log_prefix,
        log_bucket_policy,
        opts=None,
    ):
        super().__init__("joynnovate:infra:Serving", name, None, opts)
        child = pulumi.ResourceOptions(parent=self)

        self.cluster = aws.ecs.Cluster("main", name=f"{name}-cluster", opts=child)

        us_east_1 = aws.Provider(
            "us-east-1",
            region=CLOUDFRONT_CERTIFICATE_REGION,
            opts=child,
        )

        alb_certificate = aws.acm.Certificate(
            "alb",
            domain_name=domain,
            subject_alternative_names=[f"*.{domain}"],
            validation_method="DNS",
            opts=child,
        )

        self.cloudfront_certificate = aws.acm.Certificate(
            "cloudfront",
            domain_name=domain,
            subject_alternative_names=[f"*.{domain}"],
            validation_method="DNS",
            opts=pulumi.ResourceOptions(parent=self, provider=us_east_1),
        )

        option = alb_certificate.domain_validation_options[0]
        validation_record = cloudflare.DnsRecord(
            "acm-validation",
            zone_id=zone_id,
            name=option.resource_record_name.apply(lambda value: value.rstrip(".")),
            type=option.resource_record_type,
            content=option.resource_record_value.apply(lambda value: value.rstrip(".")),
            ttl=VALIDATION_RECORD_TTL,
            proxied=False,
            comment="ACM domain validation",
            opts=child,
        )
        validation_fqdns = [validation_record.name]

        alb_certificate_validation = aws.acm.CertificateValidation(
            "alb",
            certificate_arn=alb_certificate.arn,
            validation_record_fqdns=validation_fqdns,
            opts=child,
        )

        aws.acm.CertificateValidation(
            "cloudfront",
            certificate_arn=self.cloudfront_certificate.arn,
            validation_record_fqdns=validation_fqdns,
            opts=pulumi.ResourceOptions(parent=self, provider=us_east_1),
        )

        self.alb = aws.lb.LoadBalancer(
            "main",
            name=f"{name}-alb",
            load_balancer_type="application",
            subnets=[subnet.id for subnet in subnets],
            security_groups=[alb_security_group.id],
            access_logs=aws.lb.LoadBalancerAccessLogsArgs(
                bucket=log_bucket.bucket,
                prefix=log_prefix,
                enabled=True,
            ),
            opts=pulumi.ResourceOptions(parent=self, depends_on=[log_bucket_policy]),
        )

        self.https_listener = aws.lb.Listener(
            "https",
            load_balancer_arn=self.alb.arn,
            port=443,
            protocol="HTTPS",
            ssl_policy=TLS_POLICY,
            certificate_arn=alb_certificate_validation.certificate_arn,
            default_actions=[
                aws.lb.ListenerDefaultActionArgs(
                    type="fixed-response",
                    fixed_response=aws.lb.ListenerDefaultActionFixedResponseArgs(
                        content_type="text/plain",
                        message_body="Not Found",
                        status_code="404",
                    ),
                )
            ],
            opts=child,
        )

        aws.lb.Listener(
            "http",
            load_balancer_arn=self.alb.arn,
            port=80,
            protocol="HTTP",
            default_actions=[
                aws.lb.ListenerDefaultActionArgs(
                    type="redirect",
                    redirect=aws.lb.ListenerDefaultActionRedirectArgs(
                        port="443",
                        protocol="HTTPS",
                        status_code="HTTP_301",
                    ),
                )
            ],
            opts=child,
        )

        self.register_outputs({})
