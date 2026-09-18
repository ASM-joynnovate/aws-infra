import json

import pulumi
import pulumi_aws as aws

from data import CORS_ORIGINS, ROOT_DOMAIN
from edge import Landing, LandingArgs, MbtiCdn, MbtiCdnArgs
from service import Api, ApiArgs, WebService, WebServiceArgs

API_PREFIX = "jn-buddybird-api"
BACKOFFICE_FRONTEND_PREFIX = "jn-buddybird-backoffice-frontend"
LANDING_PREFIX = "jn-buddybird-site"
MBTI_WEB_PREFIX = "jn-buddybird-mbti"

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
SHARED_STACK = "organization/buddybird-shared/prod"

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id

config = pulumi.Config()
infra = pulumi.StackReference(INFRA_STACK)
shared = pulumi.StackReference(SHARED_STACK)

vpc_id = infra.require_output("vpc_id")
public_subnet_ids = infra.require_output("public_subnet_ids")
task_security_group_id = infra.require_output("task_security_group_id")
db_security_group_id = infra.require_output("db_security_group_id")
cluster_arn = infra.require_output("cluster_arn")
alb_dns_name = infra.require_output("alb_dns_name")
https_listener_arn = infra.require_output("https_listener_arn")
cloudfront_certificate_arn = infra.require_output("cloudfront_certificate_arn")


api_repository_url = shared.require_output("api_repository_url")
backoffice_frontend_repository_url = shared.require_output(
    "backoffice_frontend_repository_url"
)
mbti_web_repository_url = shared.require_output("mbti_web_repository_url")
db_subnet_group_name = shared.require_output("db_subnet_group_name")

apis = {}
for env, api_settings in API_ENVIRONMENTS.items():
    is_dev = env == "dev"
    backoffice_frontend_settings = BACKOFFICE_FRONTEND_ENVIRONMENTS[env]

    apis[env] = Api(
        f"api-{env}",
        ApiArgs(
            env=env,
            service_name=f"{API_PREFIX}-{env}",
            account_id=account_id,
            region=region,
            image=api_repository_url.apply(lambda url: f"{url}:{BOOTSTRAP_IMAGE_TAG}"),
            hostname=api_settings["hostname"],
            priority=api_settings["priority"],
            cors_origin=json.dumps(
                [f"https://{backoffice_frontend_settings['hostname']}"]
            ),
            data_cors_origins=CORS_ORIGINS[env],
            deletion_protection=env == "prod",
            subnet_group_name=db_subnet_group_name,
            db_security_group_id=db_security_group_id,
            access_token_key=config.require_secret("authAccessTokenKey"),
            refresh_token_key=config.require_secret("authRefreshTokenKey"),
            backoffice_password=config.require_secret("backofficePassword"),
            readonly_db_password=config.require_secret("readonlyDbPassword"),
            vpc_id=vpc_id,
            subnet_ids=public_subnet_ids,
            task_security_group_id=task_security_group_id,
            cluster_arn=cluster_arn,
            listener_arn=https_listener_arn,
            dns_target=alb_dns_name if is_dev else None,
            local_data_cors_origins=CORS_ORIGINS["local"] if is_dev else None,
        ),
    )

    WebService(
        f"backoffice-frontend-{env}",
        WebServiceArgs(
            service="backoffice-frontend",
            service_name=f"{BACKOFFICE_FRONTEND_PREFIX}-{env}",
            target_group_name=f"jn-buddybird-bo-fe-{env}",
            image=pulumi.Output.concat(
                backoffice_frontend_repository_url,
                f":{env}-bootstrap",
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
            image=pulumi.Output.concat(mbti_web_repository_url, f":{env}-bootstrap"),
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

pulumi.export("data_dev_bucket_name", apis["dev"].data.bucket.id)
pulumi.export("data_prod_bucket_name", apis["prod"].data.bucket.id)
pulumi.export("data_local_bucket_name", apis["dev"].local_data.bucket.id)
pulumi.export("landing_bucket_name", landing.bucket.id)
pulumi.export("landing_distribution_id", landing.distribution.id)
pulumi.export("landing_distribution_domain", landing.distribution.domain_name)
pulumi.export("landing_deploy_role_arn", landing.deploy_role.arn)

pulumi.export("mbti_web_distribution_id", mbti_cdn.distribution.id)
pulumi.export("mbti_web_distribution_domain", mbti_cdn.distribution.domain_name)
pulumi.export("mbti_web_cdn_enabled", mbti_cdn_enabled)
