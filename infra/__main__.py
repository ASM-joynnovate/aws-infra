import pulumi
import pulumi_aws as aws

from bastion import Bastion, BastionArgs
from cost import Cost, CostArgs
from logs import Logging, LoggingArgs
from network import Network, NetworkArgs
from serving import Serving, ServingArgs

NAME_PREFIX = "jn"
ROOT_DOMAIN = "buddybird.xyz"
CLOUDFLARE_ZONE_ID = "fa5a1e637498dd11b4bf43211181f9e8"

ALB_LOG_PREFIX = "alb"
FLOW_LOG_PREFIX = "vpc-flow-log"
LOG_RETENTION_DAYS = 30

BUDGET_LIMIT_USD = 200
BUDGET_ALERT_PERCENTS = [50, 75, 90]
BUDGET_EMAILS = ["joynnovate@gmail.com"]

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id

log_storage = Logging(
    f"{NAME_PREFIX}-logging",
    LoggingArgs(
        bucket_name=f"{NAME_PREFIX}-logs-{account_id}-{region}",
        account_id=account_id,
        region=region,
        alb_log_prefix=ALB_LOG_PREFIX,
        retention_days=LOG_RETENTION_DAYS,
    ),
)

network = Network(
    NAME_PREFIX,
    NetworkArgs(
        region=region,
        log_bucket_arn=log_storage.bucket.arn,
        log_prefix=FLOW_LOG_PREFIX,
        log_bucket_policy=log_storage.policy,
    ),
)

serving = Serving(
    NAME_PREFIX,
    ServingArgs(
        domain=ROOT_DOMAIN,
        zone_id=CLOUDFLARE_ZONE_ID,
        subnet_ids=[subnet.id for subnet in network.public_subnets],
        alb_security_group_id=network.alb_security_group.id,
        log_bucket_name=log_storage.bucket.bucket,
        log_prefix=ALB_LOG_PREFIX,
        log_bucket_policy=log_storage.policy,
    ),
)

bastion = Bastion(
    f"{NAME_PREFIX}-bastion",
    BastionArgs(
        instance_name=f"{NAME_PREFIX}-ssm",
        subnet_id=network.public_subnets[0].id,
        security_group_id=network.ssm_security_group.id,
    ),
)

Cost(
    f"{NAME_PREFIX}-cost",
    CostArgs(
        budget_name=f"{NAME_PREFIX}-monthly",
        limit_usd=BUDGET_LIMIT_USD,
        alert_percents=BUDGET_ALERT_PERCENTS,
        emails=BUDGET_EMAILS,
    ),
)

pulumi.export("vpc_id", network.vpc.id)
pulumi.export("public_subnet_ids", [subnet.id for subnet in network.public_subnets])
pulumi.export("private_subnet_ids", [subnet.id for subnet in network.private_subnets])
pulumi.export("task_security_group_id", network.task_security_group.id)
pulumi.export("db_security_group_id", network.db_security_group.id)
pulumi.export("ssm_instance_id", bastion.instance.id)
pulumi.export("cluster_arn", serving.cluster.arn)
pulumi.export("alb_dns_name", serving.alb.dns_name)
pulumi.export("https_listener_arn", serving.https_listener.arn)
pulumi.export("cloudfront_certificate_arn", serving.cloudfront_certificate.arn)
