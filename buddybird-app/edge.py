import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

from data import _harden_bucket

API_PATH_PATTERN = "/api/*"
SITE_ERROR_CACHE_TTL = 60

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


def site_bucket(name: str) -> aws.s3.Bucket:
    bucket = aws.s3.Bucket("site", bucket=name)
    _harden_bucket("site", bucket)
    return bucket


def distribution(
    *,
    bucket: aws.s3.Bucket,
    alb_dns_name: pulumi.Input[str],
    certificate_arn: pulumi.Input[str],
    aliases: list[str],
) -> aws.cloudfront.Distribution:
    access_control = aws.cloudfront.OriginAccessControl(
        "site",
        name="jn-buddybird-site",
        origin_access_control_origin_type="s3",
        signing_behavior="always",
        signing_protocol="sigv4",
    )

    rewrite = aws.cloudfront.Function(
        "rewrite",
        name="jn-buddybird-site-rewrite",
        runtime="cloudfront-js-2.0",
        code=REWRITE_FUNCTION,
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

    cdn = aws.cloudfront.Distribution(
        "site",
        enabled=True,
        is_ipv6_enabled=True,
        aliases=aliases,
        default_root_object="index.html",
        origins=[
            aws.cloudfront.DistributionOriginArgs(
                origin_id="site",
                domain_name=bucket.bucket_regional_domain_name,
                origin_access_control_id=access_control.id,
            ),
            aws.cloudfront.DistributionOriginArgs(
                origin_id="api",
                domain_name=alb_dns_name,
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
                error_caching_min_ttl=SITE_ERROR_CACHE_TTL,
            )
        ],
        restrictions=aws.cloudfront.DistributionRestrictionsArgs(
            geo_restriction=aws.cloudfront.DistributionRestrictionsGeoRestrictionArgs(
                restriction_type="none"
            )
        ),
        viewer_certificate=aws.cloudfront.DistributionViewerCertificateArgs(
            acm_certificate_arn=certificate_arn,
            ssl_support_method="sni-only",
            minimum_protocol_version="TLSv1.2_2021",
        ),
    )

    aws.s3.BucketPolicy(
        "site",
        bucket=bucket.id,
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
                    resources=[pulumi.Output.format("{0}/*", bucket.arn)],
                    conditions=[
                        GetPolicyDocumentStatementConditionArgs(
                            test="StringEquals",
                            variable="AWS:SourceArn",
                            values=[cdn.arn],
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
                        bucket.arn,
                        pulumi.Output.format("{0}/*", bucket.arn),
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
    )

    return cdn


def mbti_web_distribution(
    *,
    alb_dns_name: pulumi.Input[str],
    certificate_arn: pulumi.Input[str],
    hostname: str,
) -> aws.cloudfront.Distribution:
    image_cache = aws.cloudfront.CachePolicy(
        "mbti-web-images",
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
    host_only = aws.cloudfront.get_origin_request_policy_output(
        name="Managed-HostHeaderOnly"
    )

    return aws.cloudfront.Distribution(
        "mbti-web",
        comment="buddybird MBTI image and static asset cache",
        enabled=True,
        is_ipv6_enabled=True,
        aliases=[hostname],
        origins=[
            aws.cloudfront.DistributionOriginArgs(
                origin_id="mbti-web",
                domain_name=alb_dns_name,
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
            origin_request_policy_id=all_viewer.id,
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
            acm_certificate_arn=certificate_arn,
            ssl_support_method="sni-only",
            minimum_protocol_version="TLSv1.2_2021",
        ),
    )
