from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

from data import harden_bucket
from dns import cname_record
from oidc import trust_policy

API_PATH_PATTERN = "/api/*"
LANDING_ERROR_CACHE_TTL = 60

LANDING_SUB_PREFIX = "repo:ASM-joynnovate@279207361/buddybird-landing@1275213976"
LANDING_DEPLOY_SUBS = [f"{LANDING_SUB_PREFIX}:ref:refs/heads/main"]
LANDING_SYNC_ACTIONS = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]

REWRITE_FUNCTION = """
function handler(event) {
    var request = event.request;
    var host = request.headers.host.value;

    if (host.startsWith('www.')) {
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: { value: 'https://' + host.slice(4) + request.uri }
            }
        };
    }

    var uri = request.uri;
    if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
    } else if (!uri.split('/').pop().includes('.')) {
        request.uri = uri + '/index.html';
    }
    return request;
}
"""


@dataclass(frozen=True)
class LandingArgs:
    account_id: str
    root_domain: str
    bucket_name: str
    deploy_role_name: str
    alb_dns_name: pulumi.Input[str]
    certificate_arn: pulumi.Input[str]


class Landing(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: LandingArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:Landing", name, None, opts)
        www_domain = f"www.{args.root_domain}"

        self.bucket = aws.s3.Bucket(
            f"{name}-bucket",
            bucket=args.bucket_name,
            opts=pulumi.ResourceOptions(parent=self),
        )
        harden_bucket(name, self.bucket, pulumi.ResourceOptions(parent=self))

        access_control = aws.cloudfront.OriginAccessControl(
            f"{name}-oac",
            name="jn-buddybird-site",
            origin_access_control_origin_type="s3",
            signing_behavior="always",
            signing_protocol="sigv4",
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        rewrite = aws.cloudfront.Function(
            f"{name}-rewrite",
            name="jn-buddybird-site-rewrite",
            runtime="cloudfront-js-2.0",
            code=REWRITE_FUNCTION,
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        caching_optimized = aws.cloudfront.get_cache_policy_output(
            name="Managed-CachingOptimized"
        )
        caching_disabled = aws.cloudfront.get_cache_policy_output(
            name="Managed-CachingDisabled"
        )
        all_viewer = aws.cloudfront.get_origin_request_policy_output(
            name="Managed-AllViewer"
        )

        self.distribution = aws.cloudfront.Distribution(
            f"{name}-distribution",
            enabled=True,
            is_ipv6_enabled=True,
            aliases=[args.root_domain, www_domain],
            default_root_object="index.html",
            origins=[
                aws.cloudfront.DistributionOriginArgs(
                    origin_id="site",
                    domain_name=self.bucket.bucket_regional_domain_name,
                    origin_access_control_id=access_control.id,
                ),
                aws.cloudfront.DistributionOriginArgs(
                    origin_id="api",
                    domain_name=args.alb_dns_name,
                    custom_origin_config=aws.cloudfront.DistributionOriginCustomOriginConfigArgs(
                        http_port=80,
                        https_port=443,
                        origin_protocol_policy="https-only",
                        origin_ssl_protocols=["TLSv1.2"],
                    ),
                ),
            ],
            default_cache_behavior=aws.cloudfront.DistributionDefaultCacheBehaviorArgs(
                target_origin_id="site",
                viewer_protocol_policy="redirect-to-https",
                allowed_methods=["GET", "HEAD", "OPTIONS"],
                cached_methods=["GET", "HEAD"],
                compress=True,
                cache_policy_id=caching_optimized.id,
                function_associations=[
                    aws.cloudfront.DistributionDefaultCacheBehaviorFunctionAssociationArgs(
                        event_type="viewer-request",
                        function_arn=rewrite.arn,
                    )
                ],
            ),
            ordered_cache_behaviors=[
                aws.cloudfront.DistributionOrderedCacheBehaviorArgs(
                    path_pattern=API_PATH_PATTERN,
                    target_origin_id="api",
                    viewer_protocol_policy="redirect-to-https",
                    allowed_methods=[
                        "GET",
                        "HEAD",
                        "OPTIONS",
                        "PUT",
                        "POST",
                        "PATCH",
                        "DELETE",
                    ],
                    cached_methods=["GET", "HEAD"],
                    compress=True,
                    cache_policy_id=caching_disabled.id,
                    origin_request_policy_id=all_viewer.id,
                )
            ],
            custom_error_responses=[
                aws.cloudfront.DistributionCustomErrorResponseArgs(
                    error_code=403,
                    response_code=404,
                    response_page_path="/index.html",
                    error_caching_min_ttl=LANDING_ERROR_CACHE_TTL,
                )
            ],
            restrictions=aws.cloudfront.DistributionRestrictionsArgs(
                geo_restriction=aws.cloudfront.DistributionRestrictionsGeoRestrictionArgs(
                    restriction_type="none"
                )
            ),
            viewer_certificate=aws.cloudfront.DistributionViewerCertificateArgs(
                acm_certificate_arn=args.certificate_arn,
                ssl_support_method="sni-only",
                minimum_protocol_version="TLSv1.2_2021",
            ),
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.s3.BucketPolicy(
            f"{name}-bucket-policy",
            bucket=self.bucket.id,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        sid="AllowCloudFrontRead",
                        effect=PolicyStatementEffect.ALLOW,
                        principals=[
                            GetPolicyDocumentStatementPrincipalArgs(
                                type="Service",
                                identifiers=["cloudfront.amazonaws.com"],
                            )
                        ],
                        actions=["s3:GetObject"],
                        resources=[pulumi.Output.format("{0}/*", self.bucket.arn)],
                        conditions=[
                            GetPolicyDocumentStatementConditionArgs(
                                test="StringEquals",
                                variable="AWS:SourceArn",
                                values=[self.distribution.arn],
                            )
                        ],
                    ),
                    GetPolicyDocumentStatementArgs(
                        sid="DenyInsecureTransport",
                        effect=PolicyStatementEffect.DENY,
                        principals=[
                            GetPolicyDocumentStatementPrincipalArgs(
                                type="*",
                                identifiers=["*"],
                            )
                        ],
                        actions=["s3:*"],
                        resources=[
                            self.bucket.arn,
                            pulumi.Output.format("{0}/*", self.bucket.arn),
                        ],
                        conditions=[
                            GetPolicyDocumentStatementConditionArgs(
                                test="Bool",
                                variable="aws:SecureTransport",
                                values=["false"],
                            )
                        ],
                    ),
                ]
            ).json,
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.deploy_role = aws.iam.Role(
            f"{name}-deploy-role",
            name=args.deploy_role_name,
            description="buddybird-landing GitHub Actions S3 sync and CloudFront invalidation",
            assume_role_policy=trust_policy(args.account_id, LANDING_DEPLOY_SUBS),
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        aws.iam.RolePolicy(
            f"{name}-deploy-policy",
            role=self.deploy_role.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        sid="ListSiteBucket",
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["s3:ListBucket"],
                        resources=[self.bucket.arn],
                    ),
                    GetPolicyDocumentStatementArgs(
                        sid="SyncSiteObjects",
                        effect=PolicyStatementEffect.ALLOW,
                        actions=LANDING_SYNC_ACTIONS,
                        resources=[pulumi.Output.format("{0}/*", self.bucket.arn)],
                    ),
                    GetPolicyDocumentStatementArgs(
                        sid="InvalidateCache",
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["cloudfront:CreateInvalidation"],
                        resources=[self.distribution.arn],
                    ),
                ]
            ).json,
            opts=pulumi.ResourceOptions(parent=self),
        )

        cname_record(
            f"{name}-dns-root",
            hostname=args.root_domain,
            target=self.distribution.domain_name,
            opts=pulumi.ResourceOptions(parent=self),
        )
        cname_record(
            f"{name}-dns-www",
            hostname=www_domain,
            target=self.distribution.domain_name,
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.register_outputs(
            {
                "bucket": self.bucket,
                "distribution": self.distribution,
                "deploy_role": self.deploy_role,
            }
        )


@dataclass(frozen=True)
class MbtiCdnArgs:
    hostname: str
    alb_dns_name: pulumi.Input[str]
    certificate_arn: pulumi.Input[str]


class MbtiCdn(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: MbtiCdnArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:MbtiCdn", name, None, opts)

        image_cache = aws.cloudfront.CachePolicy(
            f"{name}-image-cache-policy",
            name="jn-buddybird-mbti-images",
            min_ttl=0,
            default_ttl=0,
            max_ttl=31536000,
            parameters_in_cache_key_and_forwarded_to_origin=aws.cloudfront.CachePolicyParametersInCacheKeyAndForwardedToOriginArgs(
                cookies_config=aws.cloudfront.CachePolicyParametersInCacheKeyAndForwardedToOriginCookiesConfigArgs(
                    cookie_behavior="none",
                ),
                headers_config=aws.cloudfront.CachePolicyParametersInCacheKeyAndForwardedToOriginHeadersConfigArgs(
                    header_behavior="whitelist",
                    headers=aws.cloudfront.CachePolicyParametersInCacheKeyAndForwardedToOriginHeadersConfigHeadersArgs(
                        items=["Accept"],
                    ),
                ),
                query_strings_config=aws.cloudfront.CachePolicyParametersInCacheKeyAndForwardedToOriginQueryStringsConfigArgs(
                    query_string_behavior="whitelist",
                    query_strings=aws.cloudfront.CachePolicyParametersInCacheKeyAndForwardedToOriginQueryStringsConfigQueryStringsArgs(
                        items=["url", "w", "q"],
                    ),
                ),
                enable_accept_encoding_brotli=False,
                enable_accept_encoding_gzip=False,
            ),
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )
        caching_optimized = aws.cloudfront.get_cache_policy_output(
            name="Managed-CachingOptimized"
        )
        caching_disabled = aws.cloudfront.get_cache_policy_output(
            name="Managed-CachingDisabled"
        )
        # MBTI 웹이 CloudFront-Viewer-Country로 언어를 고르므로 CloudFront 생성 헤더까지 전달한다.
        all_viewer_with_country = aws.cloudfront.get_origin_request_policy_output(
            name="Managed-AllViewerAndCloudFrontHeaders-2022-06"
        )
        host_only = aws.cloudfront.get_origin_request_policy_output(
            name="Managed-HostHeaderOnly"
        )

        self.distribution = aws.cloudfront.Distribution(
            f"{name}-distribution",
            comment="buddybird MBTI image and static asset cache",
            enabled=True,
            is_ipv6_enabled=True,
            aliases=[args.hostname],
            origins=[
                aws.cloudfront.DistributionOriginArgs(
                    origin_id="mbti-web",
                    domain_name=args.alb_dns_name,
                    custom_origin_config=aws.cloudfront.DistributionOriginCustomOriginConfigArgs(
                        http_port=80,
                        https_port=443,
                        origin_protocol_policy="https-only",
                        origin_ssl_protocols=["TLSv1.2"],
                    ),
                ),
            ],
            default_cache_behavior=aws.cloudfront.DistributionDefaultCacheBehaviorArgs(
                target_origin_id="mbti-web",
                viewer_protocol_policy="redirect-to-https",
                allowed_methods=[
                    "GET",
                    "HEAD",
                    "OPTIONS",
                    "PUT",
                    "POST",
                    "PATCH",
                    "DELETE",
                ],
                cached_methods=["GET", "HEAD"],
                compress=True,
                cache_policy_id=caching_disabled.id,
                origin_request_policy_id=all_viewer_with_country.id,
            ),
            ordered_cache_behaviors=[
                aws.cloudfront.DistributionOrderedCacheBehaviorArgs(
                    path_pattern="/_next/image",
                    target_origin_id="mbti-web",
                    viewer_protocol_policy="redirect-to-https",
                    allowed_methods=["GET", "HEAD"],
                    cached_methods=["GET", "HEAD"],
                    compress=False,
                    cache_policy_id=image_cache.id,
                    origin_request_policy_id=host_only.id,
                ),
                aws.cloudfront.DistributionOrderedCacheBehaviorArgs(
                    path_pattern="/_next/static/*",
                    target_origin_id="mbti-web",
                    viewer_protocol_policy="redirect-to-https",
                    allowed_methods=["GET", "HEAD"],
                    cached_methods=["GET", "HEAD"],
                    compress=True,
                    cache_policy_id=caching_optimized.id,
                    origin_request_policy_id=host_only.id,
                ),
            ],
            custom_error_responses=[
                aws.cloudfront.DistributionCustomErrorResponseArgs(
                    error_code=code,
                    error_caching_min_ttl=0,
                )
                for code in (403, 404, 500, 502, 503, 504)
            ],
            restrictions=aws.cloudfront.DistributionRestrictionsArgs(
                geo_restriction=aws.cloudfront.DistributionRestrictionsGeoRestrictionArgs(
                    restriction_type="none",
                ),
            ),
            viewer_certificate=aws.cloudfront.DistributionViewerCertificateArgs(
                acm_certificate_arn=args.certificate_arn,
                ssl_support_method="sni-only",
                minimum_protocol_version="TLSv1.2_2021",
            ),
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.register_outputs({"distribution": self.distribution})
