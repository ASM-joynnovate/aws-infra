import json

import pulumi
import pulumi_aws as aws
import pulumi_cloudflare as cloudflare

from data import app_secret, database, db_subnet_group
from deploy import deploy_role, ecr_repository, site_deploy_role
from service import api_service, backoffice_frontend_service
from edge import distribution, site_bucket

NAME_PREFIX = "jn-buddybird-v1"
API_PREFIX = "jn-buddybird-api"
BACKOFFICE_FRONTEND_PREFIX = "jn-buddybird-backoffice-frontend"
SITE_PREFIX = "jn-buddybird-site"
ECS_CLUSTER_NAME = "jn-cluster"

DOMAIN = "buddybird.xyz"
CLOUDFLARE_ZONE_ID = "fa5a1e637498dd11b4bf43211181f9e8"
RECORD_TTL = 300

BOOTSTRAP_IMAGE_TAG = "bootstrap"

API_ENVIRONMENTS = {
    "prod": {"hostname": DOMAIN, "priority": 10},
    "dev": {"hostname": f"dev.{DOMAIN}", "priority": 20},
}

BACKOFFICE_FRONTEND_ENVIRONMENTS = {
    "prod": {"hostname": f"backoffice.{DOMAIN}", "priority": 30},
    "dev": {"hostname": f"dev-backoffice.{DOMAIN}", "priority": 40},
}

INFRA_STACK = "organization/joynnovate-infra/prod"

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id

config = pulumi.Config()
infra = pulumi.StackReference(INFRA_STACK)


def data_bucket(env: str, *, cors_allowed_origins: list[str]) -> aws.s3.Bucket:
    name = f"data-{env}"

    bucket = aws.s3.Bucket(
        name,
        bucket=f"{NAME_PREFIX}-{name}-{account_id}-{region}",
    )

    aws.s3.BucketServerSideEncryptionConfiguration(
        name,
        bucket=bucket.id,
        rules=[
            aws.s3.BucketServerSideEncryptionConfigurationRuleArgs(
                apply_server_side_encryption_by_default=aws.s3.BucketServerSideEncryptionConfigurationRuleApplyServerSideEncryptionByDefaultArgs(
                    sse_algorithm="AES256"
                )
            )
        ]
    )

    aws.s3.BucketPublicAccessBlock(
        name,
        bucket=bucket.id,
        block_public_acls=True,
        block_public_policy=True,
        ignore_public_acls=True,
        restrict_public_buckets=True
    )

    aws.s3.BucketOwnershipControls(
        name,
        bucket=bucket.id,
        rule=aws.s3.BucketOwnershipControlsRuleArgs(
            object_ownership="BucketOwnerEnforced"
        )
    )

    aws.s3.BucketLifecycleConfiguration(
        name,
        bucket=bucket.id,
        rules=[
            aws.s3.BucketLifecycleConfigurationRuleArgs(
                id="abort-incomplete-multipart-upload",
                status="Enabled",
                filter=aws.s3.BucketLifecycleConfigurationRuleFilterArgs(),
                abort_incomplete_multipart_upload=aws.s3.BucketLifecycleConfigurationRuleAbortIncompleteMultipartUploadArgs(
                    days_after_initiation=7
                ),
            ),
        ]
    )

    aws.s3.BucketPolicy(
        f"{name}-tls-only",
        bucket=bucket.id,
        policy=pulumi.Output.json_dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "DenyInsecureTransport",
                        "Effect": "Deny",
                        "Principal": "*",
                        "Action": "s3:*",
                        "Resource": [
                            bucket.arn,
                            pulumi.Output.format("{0}/*", bucket.arn),
                        ],
                        "Condition": {"Bool": {"aws:SecureTransport": "false"}},
                    }
                ],
            }
        ),
    )

    aws.s3.BucketCorsConfiguration(
        name,
        bucket=bucket.id,
        cors_rules=[
            aws.s3.BucketCorsConfigurationCorsRuleArgs(
                allowed_headers=["*"],
                allowed_methods=["GET"],
                allowed_origins=cors_allowed_origins,
                expose_headers=["Content-Length", "Content-Type"],
            )
        ],
    )

    return bucket


CORS_ORIGINS = {
    "local": ["http://localhost:3000"],
    "dev": [f"https://dev.{DOMAIN}", f"https://dev-backoffice.{DOMAIN}"],
    "prod": [f"https://{DOMAIN}", f"https://backoffice.{DOMAIN}"],
}

buckets = {
    env: data_bucket(env, cors_allowed_origins=CORS_ORIGINS[env])
    for env in ("dev", "prod", "local")
}

repository = ecr_repository(API_PREFIX, logical_name="api")
backoffice_frontend_repository = ecr_repository(
    BACKOFFICE_FRONTEND_PREFIX, logical_name="backoffice-frontend"
)

deploy = deploy_role(
    name=f"{API_PREFIX}-deploy",
    account_id=account_id,
    region=region,
    repository_arn=repository.arn,
    cluster_arn=infra.get_output("cluster_arn"),
    cluster_name=ECS_CLUSTER_NAME,
    prefix=API_PREFIX,
)

subnet_group = db_subnet_group(API_PREFIX, infra.get_output("private_subnet_ids"))

for env, api_settings in API_ENVIRONMENTS.items():
    name = f"{API_PREFIX}-{env}"

    db = database(
        env,
        name=name,
        subnet_group_name=subnet_group.name,
        security_group_id=infra.get_output("db_security_group_id"),
    )

    secret = app_secret(
        env,
        name=name,
        access_token_key=config.require_secret("authAccessTokenKey"),
        refresh_token_key=config.require_secret("authRefreshTokenKey"),
        backoffice_password=config.require_secret("backofficePassword"),
    )

    backoffice_frontend_settings = BACKOFFICE_FRONTEND_ENVIRONMENTS[env]

    api_service(
        env,
        name=name,
        image=repository.repository_url.apply(
            lambda url: f"{url}:{BOOTSTRAP_IMAGE_TAG}"
        ),
        region=region,
        bucket=buckets[env],
        database=db,
        secret=secret,
        vpc_id=infra.get_output("vpc_id"),
        subnet_ids=infra.get_output("public_subnet_ids"),
        task_security_group_id=infra.get_output("task_security_group_id"),
        cluster_arn=infra.get_output("cluster_arn"),
        listener_arn=infra.get_output("https_listener_arn"),
        hostname=api_settings["hostname"],
        priority=api_settings["priority"],
        cors_origin=json.dumps(
            [f"https://{backoffice_frontend_settings['hostname']}"]
        ),
    )

    backoffice_frontend_service(
        env,
        name=f"{BACKOFFICE_FRONTEND_PREFIX}-{env}",
        target_group_name=f"jn-buddybird-bo-fe-{env}",
        image=pulumi.Output.concat(
            backoffice_frontend_repository.repository_url, f":{env}-bootstrap"
        ),
        region=region,
        vpc_id=infra.get_output("vpc_id"),
        subnet_ids=infra.get_output("public_subnet_ids"),
        task_security_group_id=infra.get_output("task_security_group_id"),
        cluster_arn=infra.get_output("cluster_arn"),
        listener_arn=infra.get_output("https_listener_arn"),
        hostname=backoffice_frontend_settings["hostname"],
        priority=backoffice_frontend_settings["priority"],
    )

site = site_bucket(f"{SITE_PREFIX}-{account_id}-{region}")

cdn = distribution(
    bucket=site,
    alb_dns_name=infra.get_output("alb_dns_name"),
    certificate_arn=infra.get_output("cloudfront_certificate_arn"),
    aliases=[DOMAIN, f"www.{DOMAIN}"],
)

site_deploy = site_deploy_role(
    name=f"{SITE_PREFIX}-deploy",
    account_id=account_id,
    bucket_arn=site.arn,
    distribution_arn=cdn.arn,
)

for label, hostname, target in (
    ("root", DOMAIN, cdn.domain_name),
    ("www", f"www.{DOMAIN}", cdn.domain_name),
    ("dev", f"dev.{DOMAIN}", infra.get_output("alb_dns_name")),
    ("backoffice", f"backoffice.{DOMAIN}", infra.get_output("alb_dns_name")),
    ("dev-backoffice", f"dev-backoffice.{DOMAIN}", infra.get_output("alb_dns_name")),
):
    cloudflare.DnsRecord(
        label,
        zone_id=CLOUDFLARE_ZONE_ID,
        name=hostname,
        type="CNAME",
        content=target,
        ttl=RECORD_TTL,
        proxied=False,
        comment="buddybird service",
    )

pulumi.export("data_dev_bucket_name", buckets["dev"].id)
pulumi.export("data_prod_bucket_name", buckets["prod"].id)
pulumi.export("data_local_bucket_name", buckets["local"].id)
pulumi.export("api_repository_url", repository.repository_url)
pulumi.export(
    "backoffice_frontend_repository_url",
    backoffice_frontend_repository.repository_url,
)
pulumi.export("deploy_role_arn", deploy.arn)
pulumi.export("site_bucket_name", site.id)
pulumi.export("site_distribution_id", cdn.id)
pulumi.export("site_distribution_domain", cdn.domain_name)
pulumi.export("site_deploy_role_arn", site_deploy.arn)