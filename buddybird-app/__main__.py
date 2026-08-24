import json

import pulumi
import pulumi_aws as aws
import pulumi_cloudflare as cloudflare

from data import (
    CORS_ORIGINS,
    ROOT_DOMAIN,
    app_secret,
    data_bucket,
    database,
    db_subnet_group,
)
from deploy import deploy_role, ecr_repository, site_deploy_role
from service import api_service, backoffice_frontend_service
from edge import distribution, site_bucket

API_PREFIX = "jn-buddybird-api"
BACKOFFICE_FRONTEND_PREFIX = "jn-buddybird-backoffice-frontend"
SITE_PREFIX = "jn-buddybird-site"
ECS_CLUSTER_NAME = "jn-cluster"

CLOUDFLARE_ZONE_ID = "fa5a1e637498dd11b4bf43211181f9e8"
DNS_RECORD_TTL = 300

BOOTSTRAP_IMAGE_TAG = "bootstrap"

API_ENVIRONMENTS = {
    "prod": {"hostname": ROOT_DOMAIN, "priority": 10},
    "dev": {"hostname": f"dev.{ROOT_DOMAIN}", "priority": 20},
}

BACKOFFICE_FRONTEND_ENVIRONMENTS = {
    "prod": {"hostname": f"backoffice.{ROOT_DOMAIN}", "priority": 30},
    "dev": {"hostname": f"dev-backoffice.{ROOT_DOMAIN}", "priority": 40},
}

INFRA_STACK = "organization/joynnovate-infra/prod"

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id

config = pulumi.Config()
infra = pulumi.StackReference(INFRA_STACK)


buckets = {
    env: data_bucket(
        env,
        account_id=account_id,
        region=region,
        cors_allowed_origins=CORS_ORIGINS[env],
    )
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
    aliases=[ROOT_DOMAIN, f"www.{ROOT_DOMAIN}"],
)

site_deploy = site_deploy_role(
    name=f"{SITE_PREFIX}-deploy",
    account_id=account_id,
    bucket_arn=site.arn,
    distribution_arn=cdn.arn,
)

for label, hostname, target in (
    ("root", ROOT_DOMAIN, cdn.domain_name),
    ("www", f"www.{ROOT_DOMAIN}", cdn.domain_name),
    ("dev", f"dev.{ROOT_DOMAIN}", infra.get_output("alb_dns_name")),
    ("backoffice", f"backoffice.{ROOT_DOMAIN}", infra.get_output("alb_dns_name")),
    ("dev-backoffice", f"dev-backoffice.{ROOT_DOMAIN}", infra.get_output("alb_dns_name")),
):
    cloudflare.DnsRecord(
        label,
        zone_id=CLOUDFLARE_ZONE_ID,
        name=hostname,
        type="CNAME",
        content=target,
        ttl=DNS_RECORD_TTL,
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