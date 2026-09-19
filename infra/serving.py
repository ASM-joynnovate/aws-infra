from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
import pulumi_cloudflare as cloudflare

CLOUDFRONT_CERTIFICATE_REGION = "us-east-1"
ALB_TLS_POLICY = "ELBSecurityPolicy-TLS13-1-2-2021-06"
ACM_VALIDATION_RECORD_TTL = 60
CLUSTER_CAPACITY_PROVIDERS = ["FARGATE", "FARGATE_SPOT"]


@dataclass(frozen=True)
class ServingArgs:
    domain: str
    zone_id: pulumi.Input[str]
    subnet_ids: Sequence[pulumi.Input[str]]
    alb_security_group_id: pulumi.Input[str]
    log_bucket_name: pulumi.Input[str]
    log_prefix: str
    log_bucket_policy: aws.s3.BucketPolicy


class Serving(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: ServingArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:infra:Serving", name, None, opts)

        self.cluster = aws.ecs.Cluster(
            f"{name}-cluster",
            name=f"{name}-cluster",
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.ecs.ClusterCapacityProviders(
            f"{name}-cluster-capacity-providers",
            cluster_name=self.cluster.name,
            capacity_providers=CLUSTER_CAPACITY_PROVIDERS,
            opts=pulumi.ResourceOptions(parent=self),
        )

        us_east_1 = aws.Provider(
            "us-east-1",
            region=CLOUDFRONT_CERTIFICATE_REGION,
            opts=pulumi.ResourceOptions(parent=self),
        )

        alb_certificate = aws.acm.Certificate(
            f"{name}-alb-certificate",
            domain_name=args.domain,
            subject_alternative_names=[f"*.{args.domain}"],
            validation_method="DNS",
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.cloudfront_certificate = aws.acm.Certificate(
            f"{name}-cloudfront-certificate",
            domain_name=args.domain,
            subject_alternative_names=[f"*.{args.domain}"],
            validation_method="DNS",
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(provider=us_east_1),
            ),
        )

        option = alb_certificate.domain_validation_options[0]
        validation_record = cloudflare.DnsRecord(
            f"{name}-acm-validation",
            zone_id=args.zone_id,
            name=option.resource_record_name.apply(lambda value: value.rstrip(".")),
            type=option.resource_record_type,
            content=option.resource_record_value.apply(lambda value: value.rstrip(".")),
            ttl=ACM_VALIDATION_RECORD_TTL,
            proxied=False,
            comment="ACM domain validation",
            opts=pulumi.ResourceOptions(parent=self),
        )
        validation_fqdns = [validation_record.name]

        alb_certificate_validation = aws.acm.CertificateValidation(
            f"{name}-alb-certificate-validation",
            certificate_arn=alb_certificate.arn,
            validation_record_fqdns=validation_fqdns,
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.acm.CertificateValidation(
            f"{name}-cloudfront-certificate-validation",
            certificate_arn=self.cloudfront_certificate.arn,
            validation_record_fqdns=validation_fqdns,
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(provider=us_east_1),
            ),
        )

        self.alb = aws.lb.LoadBalancer(
            f"{name}-alb",
            name=f"{name}-alb",
            load_balancer_type="application",
            subnets=list(args.subnet_ids),
            security_groups=[args.alb_security_group_id],
            access_logs=aws.lb.LoadBalancerAccessLogsArgs(
                bucket=args.log_bucket_name,
                prefix=args.log_prefix,
                enabled=True,
            ),
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(depends_on=[args.log_bucket_policy]),
            ),
        )

        self.https_listener = aws.lb.Listener(
            f"{name}-https-listener",
            load_balancer_arn=self.alb.arn,
            port=443,
            protocol="HTTPS",
            ssl_policy=ALB_TLS_POLICY,
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
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.lb.Listener(
            f"{name}-http-listener",
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
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.register_outputs(
            {
                "cluster": self.cluster,
                "cloudfront_certificate": self.cloudfront_certificate,
                "alb": self.alb,
                "https_listener": self.https_listener,
            }
        )
