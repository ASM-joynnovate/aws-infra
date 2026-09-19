import json

import pulumi
import pulumi_aws as aws

from data import LOCAL_CORS_ORIGINS, ROOT_DOMAIN
from edge import Landing, LandingArgs, MbtiCdn, MbtiCdnArgs
from schedule import NightlyStop, NightlyStopArgs
from service import DEFAULT_CAPACITY, Api, ApiArgs, WebService, WebServiceArgs

API_PREFIX = "jn-buddybird-api"
BACKOFFICE_FRONTEND_PREFIX = "jn-buddybird-backoffice-frontend"
LANDING_PREFIX = "jn-buddybird-site"
MBTI_WEB_PREFIX = "jn-buddybird-mbti"

BOOTSTRAP_IMAGE_TAG = "bootstrap"

INFRA_STACK = "organization/joynnovate-infra/prod"
SHARED_STACK = "organization/buddybird-shared/prod"


def hostname(subdomain: str | None) -> str:
    return f"{subdomain}.{ROOT_DOMAIN}" if subdomain else ROOT_DOMAIN


env = pulumi.get_stack()
region = aws.get_region().region
account_id = aws.get_caller_identity().account_id

config = pulumi.Config()
api_settings = config.require_object("api")
backoffice_frontend_settings = config.get_object("backofficeFrontend")
mbti_web_settings = config.get_object("mbtiWeb")
landing_enabled = config.get_bool("landing") or False
local_data_bucket_enabled = config.get_bool("localDataBucket") or False
db_deletion_protection = config.get_bool("dbDeletionProtection") or False
mbti_cdn_enabled = config.get_bool("mbtiCdnEnabled") or False
nightly_stop_enabled = config.get_bool("nightlyStop") or False

api_hostname = hostname(api_settings.get("subdomain"))
backoffice_frontend_hostname = (
    hostname(backoffice_frontend_settings["subdomain"])
    if backoffice_frontend_settings is not None
    else None
)
backoffice_frontend_origins = (
    [f"https://{backoffice_frontend_hostname}"]
    if backoffice_frontend_hostname is not None
    else LOCAL_CORS_ORIGINS
)

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

api = Api(
    f"api-{env}",
    ApiArgs(
        env=env,
        service_name=f"{API_PREFIX}-{env}",
        account_id=account_id,
        region=region,
        image=api_repository_url.apply(lambda url: f"{url}:{BOOTSTRAP_IMAGE_TAG}"),
        hostname=api_hostname,
        priority=api_settings["priority"],
        cors_origin=json.dumps(backoffice_frontend_origins),
        data_cors_origins=[f"https://{api_hostname}", *backoffice_frontend_origins],
        deletion_protection=db_deletion_protection,
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
        dns_target=None if landing_enabled else alb_dns_name,
        local_data_cors_origins=(
            LOCAL_CORS_ORIGINS if local_data_bucket_enabled else None
        ),
        capacity=api_settings.get("capacity", DEFAULT_CAPACITY),
    ),
)

if backoffice_frontend_settings is not None:
    WebService(
        f"backoffice-frontend-{env}",
        WebServiceArgs(
            service="backoffice-frontend",
            service_name=f"{BACKOFFICE_FRONTEND_PREFIX}-{env}",
            target_group_name=f"jn-buddybird-bo-fe-{env}",
            image=pulumi.Output.concat(
                backoffice_frontend_repository_url, f":{env}-bootstrap"
            ),
            region=region,
            hostname=backoffice_frontend_hostname,
            priority=backoffice_frontend_settings["priority"],
            dns_target=alb_dns_name,
            vpc_id=vpc_id,
            subnet_ids=public_subnet_ids,
            task_security_group_id=task_security_group_id,
            cluster_arn=cluster_arn,
            listener_arn=https_listener_arn,
            capacity=backoffice_frontend_settings.get("capacity", DEFAULT_CAPACITY),
        ),
    )

if nightly_stop_enabled:
    NightlyStop(
        f"nightly-stop-{env}",
        NightlyStopArgs(
            name_prefix=f"jn-buddybird-{env}",
            cluster_arn=cluster_arn,
            service=api.service,
            database=api.database.instance,
        ),
    )

pulumi.export("data_bucket_name", api.data.bucket.id)
if api.local_data is not None:
    pulumi.export("data_local_bucket_name", api.local_data.bucket.id)

if mbti_web_settings is not None:
    mbti_web_hostname = hostname(mbti_web_settings["subdomain"])

    mbti_cdn = MbtiCdn(
        f"mbti-cdn-{env}",
        MbtiCdnArgs(
            hostname=mbti_web_hostname,
            alb_dns_name=alb_dns_name,
            certificate_arn=cloudfront_certificate_arn,
        ),
    )

    WebService(
        f"mbti-web-{env}",
        WebServiceArgs(
            service="mbti-web",
            service_name=f"{MBTI_WEB_PREFIX}-{env}",
            target_group_name=f"{MBTI_WEB_PREFIX}-{env}",
            image=pulumi.Output.concat(mbti_web_repository_url, f":{env}-bootstrap"),
            region=region,
            hostname=mbti_web_hostname,
            priority=mbti_web_settings["priority"],
            dns_target=(
                mbti_cdn.distribution.domain_name if mbti_cdn_enabled else alb_dns_name
            ),
            vpc_id=vpc_id,
            subnet_ids=public_subnet_ids,
            task_security_group_id=task_security_group_id,
            cluster_arn=cluster_arn,
            listener_arn=https_listener_arn,
        ),
    )

    pulumi.export("mbti_web_distribution_id", mbti_cdn.distribution.id)
    pulumi.export("mbti_web_distribution_domain", mbti_cdn.distribution.domain_name)
    pulumi.export("mbti_web_cdn_enabled", mbti_cdn_enabled)

if landing_enabled:
    landing = Landing(
        f"landing-{env}",
        LandingArgs(
            account_id=account_id,
            root_domain=ROOT_DOMAIN,
            bucket_name=f"{LANDING_PREFIX}-{account_id}-{region}",
            deploy_role_name=f"{LANDING_PREFIX}-deploy",
            alb_dns_name=alb_dns_name,
            certificate_arn=cloudfront_certificate_arn,
        ),
    )

    pulumi.export("landing_bucket_name", landing.bucket.id)
    pulumi.export("landing_distribution_id", landing.distribution.id)
    pulumi.export("landing_distribution_domain", landing.distribution.domain_name)
    pulumi.export("landing_deploy_role_arn", landing.deploy_role.arn)
