import pulumi
import pulumi_aws as aws

from data import DbNetwork, DbNetworkArgs
from deploy import (
    API_DEPLOY_SUBS,
    AUDIO_AI_DEPLOY_SUBS,
    BACKOFFICE_FRONTEND_DEPLOY_SUBS,
    MBTI_WEB_DEPLOY_SUBS,
    ImageDelivery,
    ImageDeliveryArgs,
    repository,
)
from ota import Ota, OtaArgs

API_PREFIX = "jn-buddybird-api"
BACKOFFICE_FRONTEND_PREFIX = "jn-buddybird-backoffice-frontend"
MBTI_WEB_PREFIX = "jn-buddybird-mbti"
AUDIO_AI_PREFIX = "jn-buddybird-audio-ai"
ECS_CLUSTER_NAME = "jn-cluster"

INFRA_STACK = "organization/joynnovate-infra/prod"

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id

config = pulumi.Config()

infra = pulumi.StackReference(INFRA_STACK)

cluster_arn = infra.require_output("cluster_arn")
private_subnet_ids = infra.require_output("private_subnet_ids")

api_delivery = ImageDelivery(
    "api",
    ImageDeliveryArgs(
        repository_names={"api": API_PREFIX},
        role_name=f"{API_PREFIX}-deploy",
        subs=API_DEPLOY_SUBS,
        account_id=account_id,
        region=region,
        cluster_name=ECS_CLUSTER_NAME,
        prefix=API_PREFIX,
        migration_cluster_arn=cluster_arn,
    ),
)

backoffice_frontend_delivery = ImageDelivery(
    "backoffice-frontend",
    ImageDeliveryArgs(
        repository_names={"backoffice-frontend": BACKOFFICE_FRONTEND_PREFIX},
        role_name=f"{BACKOFFICE_FRONTEND_PREFIX}-deploy",
        subs=BACKOFFICE_FRONTEND_DEPLOY_SUBS,
        account_id=account_id,
        region=region,
        cluster_name=ECS_CLUSTER_NAME,
        prefix=BACKOFFICE_FRONTEND_PREFIX,
    ),
)

mbti_web_delivery = ImageDelivery(
    "mbti-web",
    ImageDeliveryArgs(
        repository_names={"mbti-web": MBTI_WEB_PREFIX},
        role_name=f"{MBTI_WEB_PREFIX}-deploy",
        subs=MBTI_WEB_DEPLOY_SUBS,
        account_id=account_id,
        region=region,
        cluster_name=ECS_CLUSTER_NAME,
        prefix=MBTI_WEB_PREFIX,
    ),
)

audio_ai_delivery = ImageDelivery(
    "audio-ai",
    ImageDeliveryArgs(
        repository_names={
            "parrot-detection": "jn-buddybird-parrot-detection",
            "mimic-judgment": "jn-buddybird-mimic-judgment",
        },
        role_name=f"{AUDIO_AI_PREFIX}-deploy",
        subs=AUDIO_AI_DEPLOY_SUBS,
        account_id=account_id,
        region=region,
        cluster_name=ECS_CLUSTER_NAME,
        prefix=AUDIO_AI_PREFIX,
        lambda_function=True,
    ),
)

repository(
    "audio-ai",
    repository_name=AUDIO_AI_PREFIX,
    opts=pulumi.ResourceOptions(parent=audio_ai_delivery),
)

db_network = DbNetwork(
    "db-network",
    DbNetworkArgs(subnet_group_name=API_PREFIX, subnet_ids=private_subnet_ids),
)

ota = Ota(
    "ota",
    OtaArgs(
        r2_access_key_id=config.get_secret("otaR2AccessKeyId"),
        r2_secret_access_key=config.get_secret("otaR2SecretAccessKey"),
    ),
)

pulumi.export("api_repository_url", api_delivery.repositories["api"].repository_url)
pulumi.export(
    "backoffice_frontend_repository_url",
    backoffice_frontend_delivery.repositories["backoffice-frontend"].repository_url,
)
pulumi.export(
    "mbti_web_repository_url",
    mbti_web_delivery.repositories["mbti-web"].repository_url,
)
pulumi.export(
    "parrot_detection_repository_url",
    audio_ai_delivery.repositories["parrot-detection"].repository_url,
)
pulumi.export(
    "mimic_judgment_repository_url",
    audio_ai_delivery.repositories["mimic-judgment"].repository_url,
)
pulumi.export("api_deploy_role_arn", api_delivery.deploy_role.arn)
pulumi.export(
    "backoffice_frontend_deploy_role_arn",
    backoffice_frontend_delivery.deploy_role.arn,
)
pulumi.export("mbti_web_deploy_role_arn", mbti_web_delivery.deploy_role.arn)
pulumi.export("audio_ai_deploy_role_arn", audio_ai_delivery.deploy_role.arn)
pulumi.export("db_subnet_group_name", db_network.subnet_group.name)
pulumi.export("ota_account_id", ota.account_id)
pulumi.export("ota_d1_database_id", ota.database.id)
pulumi.export("ota_d1_database_name", ota.database.name)
pulumi.export("ota_r2_bucket_name", ota.bucket.name)
