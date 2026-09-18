import json

import pulumi
import pulumi_aws as aws

from data import (
    CORS_ORIGINS,
    ROOT_DOMAIN,
    app_secret,
    data_bucket,
    database,
    db_readonly_secret,
    db_subnet_group,
)
from deploy import (
    api_deploy_role,
    backoffice_frontend_deploy_role,
    ecr_repository,
    mbti_web_deploy_role,
    rotation_redeploy,
)
from dns import cname_record
from edge import Landing, LandingArgs, MbtiCdn, MbtiCdnArgs
from service import WebService, WebServiceArgs, api_service

API_PREFIX = "jn-buddybird-api"
BACKOFFICE_FRONTEND_PREFIX = "jn-buddybird-backoffice-frontend"
LANDING_PREFIX = "jn-buddybird-site"
MBTI_WEB_PREFIX = "jn-buddybird-mbti"
ECS_CLUSTER_NAME = "jn-cluster"

BOOTSTRAP_IMAGE_TAG = "bootstrap"

API_ENVIRONMENTS = {
    "prod": {"hostname": ROOT_DOMAIN, "priority": 10},
    "dev": {"hostname": f"dev.{ROOT_DOMAIN}", "priority": 20},
}

BACKOFFICE_FRONTEND_ENVIRONMENTS = {
    "prod": {"hostname": f"backoffice.{ROOT_DOMAIN}", "priority": 30},
    "dev": {"hostname": f"dev-backoffice.{ROOT_DOMAIN}", "priority": 40},
}

MBTI_WEB_ENVIRONMENTS = {
    "prod": {"hostname": f"mbti.{ROOT_DOMAIN}", "priority": 50},
}

INFRA_STACK = "organization/joynnovate-infra/prod"

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id

config = pulumi.Config()
infra = pulumi.StackReference(INFRA_STACK)

vpc_id = infra.require_output("vpc_id")
public_subnet_ids = infra.require_output("public_subnet_ids")
private_subnet_ids = infra.require_output("private_subnet_ids")
task_security_group_id = infra.require_output("task_security_group_id")
db_security_group_id = infra.require_output("db_security_group_id")
cluster_arn = infra.require_output("cluster_arn")
alb_dns_name = infra.require_output("alb_dns_name")
https_listener_arn = infra.require_output("https_listener_arn")
cloudfront_certificate_arn = infra.require_output("cloudfront_certificate_arn")


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
mbti_web_repository = ecr_repository(MBTI_WEB_PREFIX, logical_name="mbti-web")

deploy = api_deploy_role(
    name=f"{API_PREFIX}-deploy",
    account_id=account_id,
    region=region,
    repository_arn=repository.arn,
    cluster_arn=cluster_arn,
    cluster_name=ECS_CLUSTER_NAME,
    prefix=API_PREFIX,
)

mbti_web_deploy = mbti_web_deploy_role(
    name=f"{MBTI_WEB_PREFIX}-deploy",
    account_id=account_id,
    region=region,
    repository_arn=mbti_web_repository.arn,
    cluster_name=ECS_CLUSTER_NAME,
    prefix=MBTI_WEB_PREFIX,
)

subnet_group = db_subnet_group(API_PREFIX, private_subnet_ids)

for env, api_settings in API_ENVIRONMENTS.items():
    name = f"{API_PREFIX}-{env}"

    db = database(
        env,
        name=name,
        subnet_group_name=subnet_group.name,
        security_group_id=db_security_group_id,
    )

    secret = app_secret(
        env,
        name=name,
        access_token_key=config.require_secret("authAccessTokenKey"),
        refresh_token_key=config.require_secret("authRefreshTokenKey"),
        backoffice_password=config.require_secret("backofficePassword"),
    )

    db_readonly_secret(
        env,
        name=f"{name}-readonly",
        password=config.require_secret("readonlyDbPassword"),
    )

    backoffice_frontend_settings = BACKOFFICE_FRONTEND_ENVIRONMENTS[env]

    api = api_service(
        env,
        name=name,
        image=repository.repository_url.apply(
            lambda url: f"{url}:{BOOTSTRAP_IMAGE_TAG}"
        ),
        region=region,
        bucket=buckets[env],
        database=db,
        secret=secret,
        vpc_id=vpc_id,
        subnet_ids=public_subnet_ids,
        task_security_group_id=task_security_group_id,
        cluster_arn=cluster_arn,
        listener_arn=https_listener_arn,
        hostname=api_settings["hostname"],
        priority=api_settings["priority"],
        cors_origin=json.dumps([f"https://{backoffice_frontend_settings['hostname']}"]),
    )

    rotation_redeploy(
        env,
        name=name,
        secret_arn=db.master_user_secrets[0].secret_arn,
        cluster_arn=cluster_arn,
        service=api,
    )

    WebService(
        f"backoffice-frontend-{env}",
        WebServiceArgs(
            service="backoffice-frontend",
            service_name=f"{BACKOFFICE_FRONTEND_PREFIX}-{env}",
            target_group_name=f"jn-buddybird-bo-fe-{env}",
            image=pulumi.Output.concat(
                backoffice_frontend_repository.repository_url, f":{env}-bootstrap"
            ),
            region=region,
            hostname=backoffice_frontend_settings["hostname"],
            priority=backoffice_frontend_settings["priority"],
            dns_target=alb_dns_name,
            vpc_id=vpc_id,
            subnet_ids=public_subnet_ids,
            task_security_group_id=task_security_group_id,
            cluster_arn=cluster_arn,
            listener_arn=https_listener_arn,
        ),
    )

mbti_cdn = MbtiCdn(
    "mbti-cdn-prod",
    MbtiCdnArgs(
        hostname=MBTI_WEB_ENVIRONMENTS["prod"]["hostname"],
        alb_dns_name=alb_dns_name,
        certificate_arn=cloudfront_certificate_arn,
    ),
)
mbti_cdn_enabled = config.get_bool("mbtiCdnEnabled") or False
mbti_dns_target = (
    mbti_cdn.distribution.domain_name if mbti_cdn_enabled else alb_dns_name
)

for env, mbti_web_settings in MBTI_WEB_ENVIRONMENTS.items():
    WebService(
        f"mbti-web-{env}",
        WebServiceArgs(
            service="mbti-web",
            service_name=f"{MBTI_WEB_PREFIX}-{env}",
            target_group_name=f"{MBTI_WEB_PREFIX}-{env}",
            image=pulumi.Output.concat(
                mbti_web_repository.repository_url, f":{env}-bootstrap"
            ),
            region=region,
            hostname=mbti_web_settings["hostname"],
            priority=mbti_web_settings["priority"],
            dns_target=mbti_dns_target,
            vpc_id=vpc_id,
            subnet_ids=public_subnet_ids,
            task_security_group_id=task_security_group_id,
            cluster_arn=cluster_arn,
            listener_arn=https_listener_arn,
        ),
    )

backoffice_frontend_deploy = backoffice_frontend_deploy_role(
    name=f"{BACKOFFICE_FRONTEND_PREFIX}-deploy",
    account_id=account_id,
    region=region,
    repository_arn=backoffice_frontend_repository.arn,
    cluster_name=ECS_CLUSTER_NAME,
    prefix=BACKOFFICE_FRONTEND_PREFIX,
)

landing = Landing(
    "landing-prod",
    LandingArgs(
        account_id=account_id,
        root_domain=ROOT_DOMAIN,
        bucket_name=f"{LANDING_PREFIX}-{account_id}-{region}",
        deploy_role_name=f"{LANDING_PREFIX}-deploy",
        alb_dns_name=alb_dns_name,
        certificate_arn=cloudfront_certificate_arn,
    ),
)

cname_record(
    "dev",
    hostname=API_ENVIRONMENTS["dev"]["hostname"],
    target=alb_dns_name,
    opts=pulumi.ResourceOptions(),
)

pulumi.export("data_dev_bucket_name", buckets["dev"].id)
pulumi.export("data_prod_bucket_name", buckets["prod"].id)
pulumi.export("data_local_bucket_name", buckets["local"].id)
pulumi.export("api_repository_url", repository.repository_url)
pulumi.export(
    "backoffice_frontend_repository_url",
    backoffice_frontend_repository.repository_url,
)
pulumi.export("mbti_web_repository_url", mbti_web_repository.repository_url)
pulumi.export("api_deploy_role_arn", deploy.arn)
pulumi.export("landing_bucket_name", landing.bucket.id)
pulumi.export("landing_distribution_id", landing.distribution.id)
pulumi.export("landing_distribution_domain", landing.distribution.domain_name)
pulumi.export("backoffice_frontend_deploy_role_arn", backoffice_frontend_deploy.arn)
pulumi.export("mbti_web_deploy_role_arn", mbti_web_deploy.arn)
pulumi.export("landing_deploy_role_arn", landing.deploy_role.arn)

pulumi.export("mbti_web_distribution_id", mbti_cdn.distribution.id)
pulumi.export("mbti_web_distribution_domain", mbti_cdn.distribution.domain_name)
pulumi.export("mbti_web_cdn_enabled", mbti_cdn_enabled)
