import pulumi
import pulumi_aws as aws

from data import DbNetwork, DbNetworkArgs
from deploy import (
    API_DEPLOY_SUBS,
    BACKOFFICE_FRONTEND_DEPLOY_SUBS,
    MBTI_WEB_DEPLOY_SUBS,
    ImageDelivery,
    ImageDeliveryArgs,
)

API_PREFIX = "jn-buddybird-api"
BACKOFFICE_FRONTEND_PREFIX = "jn-buddybird-backoffice-frontend"
MBTI_WEB_PREFIX = "jn-buddybird-mbti"
ECS_CLUSTER_NAME = "jn-cluster"

INFRA_STACK = "organization/joynnovate-infra/prod"

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id

infra = pulumi.StackReference(INFRA_STACK)

cluster_arn = infra.require_output("cluster_arn")
private_subnet_ids = infra.require_output("private_subnet_ids")

api_delivery = ImageDelivery(
    "api",
    ImageDeliveryArgs(
        repository_name=API_PREFIX,
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
        repository_name=BACKOFFICE_FRONTEND_PREFIX,
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
        repository_name=MBTI_WEB_PREFIX,
        role_name=f"{MBTI_WEB_PREFIX}-deploy",
        subs=MBTI_WEB_DEPLOY_SUBS,
        account_id=account_id,
        region=region,
        cluster_name=ECS_CLUSTER_NAME,
        prefix=MBTI_WEB_PREFIX,
    ),
)

db_network = DbNetwork(
    "db-network",
    DbNetworkArgs(subnet_group_name=API_PREFIX, subnet_ids=private_subnet_ids),
)

pulumi.export("api_repository_url", api_delivery.repository.repository_url)
pulumi.export(
    "backoffice_frontend_repository_url",
    backoffice_frontend_delivery.repository.repository_url,
)
pulumi.export("mbti_web_repository_url", mbti_web_delivery.repository.repository_url)
pulumi.export("api_deploy_role_arn", api_delivery.deploy_role.arn)
pulumi.export(
    "backoffice_frontend_deploy_role_arn",
    backoffice_frontend_delivery.deploy_role.arn,
)
pulumi.export("mbti_web_deploy_role_arn", mbti_web_delivery.deploy_role.arn)
pulumi.export("db_subnet_group_name", db_network.subnet_group.name)
