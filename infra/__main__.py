import pulumi
import pulumi_aws as aws

from network import Network
from serving import Serving

NAME_PREFIX = "jn"
DOMAIN = "buddybird.xyz"
CLOUDFLARE_ZONE_ID = "fa5a1e637498dd11b4bf43211181f9e8"

ALB_LOG_PREFIX = "alb"
FLOW_LOG_PREFIX = "vpc-flow-log"
LOG_RETENTION_DAYS = 30

ALB_LOG_SERVICE = "logdelivery.elasticloadbalancing.amazonaws.com"
FLOW_LOG_SERVICE = "delivery.logs.amazonaws.com"

BUDGET_LIMIT_USD = 120
BUDGET_ALERT_PERCENTS = [50, 75, 90]
BUDGET_EMAILS = ["joynnovate@gmail.com"]

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id
logs_source_arn = f"arn:aws:logs:{region}:{account_id}:*"

logs = aws.s3.Bucket(
    "logs",
    bucket=f"{NAME_PREFIX}-logs-{account_id}-{region}",
)

aws.s3.BucketServerSideEncryptionConfiguration(
    "logs",
    bucket=logs.id,
    rules=[
        aws.s3.BucketServerSideEncryptionConfigurationRuleArgs(
            apply_server_side_encryption_by_default=aws.s3.BucketServerSideEncryptionConfigurationRuleApplyServerSideEncryptionByDefaultArgs(
                sse_algorithm="AES256"
            )
        )
    ],
)

aws.s3.BucketPublicAccessBlock(
    "logs",
    bucket=logs.id,
    block_public_acls=True,
    block_public_policy=True,
    ignore_public_acls=True,
    restrict_public_buckets=True,
)

aws.s3.BucketLifecycleConfiguration(
    "logs",
    bucket=logs.id,
    rules=[
        aws.s3.BucketLifecycleConfigurationRuleArgs(
            id="expire-logs",
            status="Enabled",
            filter=aws.s3.BucketLifecycleConfigurationRuleFilterArgs(),
            expiration=aws.s3.BucketLifecycleConfigurationRuleExpirationArgs(
                days=LOG_RETENTION_DAYS
            ),
        )
    ],
)

logs_policy = aws.s3.BucketPolicy(
    "logs",
    bucket=logs.id,
    policy=pulumi.Output.json_dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "AlbAccessLogWrite",
                    "Effect": "Allow",
                    "Principal": {"Service": ALB_LOG_SERVICE},
                    "Action": "s3:PutObject",
                    "Resource": pulumi.Output.format(
                        "{0}/{1}/AWSLogs/{2}/*", logs.arn, ALB_LOG_PREFIX, account_id
                    ),
                },
                {
                    "Sid": "FlowLogWrite",
                    "Effect": "Allow",
                    "Principal": {"Service": FLOW_LOG_SERVICE},
                    "Action": "s3:PutObject",
                    "Resource": pulumi.Output.format("{0}/*", logs.arn),
                    "Condition": {
                        "StringEquals": {
                            "aws:SourceAccount": account_id,
                            "s3:x-amz-acl": "bucket-owner-full-control",
                        },
                        "ArnLike": {"aws:SourceArn": logs_source_arn},
                    },
                },
                {
                    "Sid": "FlowLogAclCheck",
                    "Effect": "Allow",
                    "Principal": {"Service": FLOW_LOG_SERVICE},
                    "Action": "s3:GetBucketAcl",
                    "Resource": logs.arn,
                    "Condition": {
                        "StringEquals": {"aws:SourceAccount": account_id},
                        "ArnLike": {"aws:SourceArn": logs_source_arn},
                    },
                },
            ],
        }
    ),
)

network = Network(
    NAME_PREFIX,
    region=region,
    log_bucket=logs,
    log_prefix=FLOW_LOG_PREFIX,
    log_bucket_policy=logs_policy,
)

serving = Serving(
    NAME_PREFIX,
    domain=DOMAIN,
    zone_id=CLOUDFLARE_ZONE_ID,
    subnets=network.public_subnets,
    alb_security_group=network.alb_security_group,
    log_bucket=logs,
    log_prefix=ALB_LOG_PREFIX,
    log_bucket_policy=logs_policy,
)

aws.budgets.Budget(
    "monthly",
    name=f"{NAME_PREFIX}-monthly",
    budget_type="COST",
    time_unit="MONTHLY",
    limit_amount=str(BUDGET_LIMIT_USD),
    limit_unit="USD",
    notifications=[
        aws.budgets.BudgetNotificationArgs(
            comparison_operator="GREATER_THAN",
            notification_type="ACTUAL",
            threshold=percent,
            threshold_type="PERCENTAGE",
            subscriber_email_addresses=BUDGET_EMAILS,
        )
        for percent in BUDGET_ALERT_PERCENTS
    ],
)

pulumi.export("vpc_id", network.vpc.id)
pulumi.export("public_subnet_ids", [subnet.id for subnet in network.public_subnets])
pulumi.export("private_subnet_ids", [subnet.id for subnet in network.private_subnets])
pulumi.export("task_security_group_id", network.task_security_group.id)
pulumi.export("db_security_group_id", network.db_security_group.id)
pulumi.export("cache_security_group_id", network.cache_security_group.id)
pulumi.export("cluster_arn", serving.cluster.arn)
pulumi.export("alb_dns_name", serving.alb.dns_name)
pulumi.export("https_listener_arn", serving.https_listener.arn)
pulumi.export("cloudfront_certificate_arn", serving.cloudfront_certificate.arn)
