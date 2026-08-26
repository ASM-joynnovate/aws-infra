import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

from network import Network
from serving import Serving
from ssm import bastion

NAME_PREFIX = "jn"
BUDDYBIRD_ROOT_DOMAIN = "buddybird.xyz"
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
    opts=pulumi.ResourceOptions(protect=True),
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
    policy=aws.iam.get_policy_document_output(
        statements=[
            GetPolicyDocumentStatementArgs(
                sid="AlbAccessLogWrite",
                effect=PolicyStatementEffect.ALLOW,
                principals=[
                    GetPolicyDocumentStatementPrincipalArgs(
                        type="Service",
                        identifiers=[ALB_LOG_SERVICE],
                    )
                ],
                actions=["s3:PutObject"],
                resources=[
                    pulumi.Output.format(
                        "{0}/{1}/AWSLogs/{2}/*", logs.arn, ALB_LOG_PREFIX, account_id
                    )
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="FlowLogWrite",
                effect=PolicyStatementEffect.ALLOW,
                principals=[
                    GetPolicyDocumentStatementPrincipalArgs(
                        type="Service",
                        identifiers=[FLOW_LOG_SERVICE],
                    )
                ],
                actions=["s3:PutObject"],
                resources=[pulumi.Output.format("{0}/*", logs.arn)],
                conditions=[
                    GetPolicyDocumentStatementConditionArgs(
                        test="StringEquals",
                        variable="aws:SourceAccount",
                        values=[account_id],
                    ),
                    GetPolicyDocumentStatementConditionArgs(
                        test="StringEquals",
                        variable="s3:x-amz-acl",
                        values=["bucket-owner-full-control"],
                    ),
                    GetPolicyDocumentStatementConditionArgs(
                        test="ArnLike",
                        variable="aws:SourceArn",
                        values=[logs_source_arn],
                    ),
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="FlowLogAclCheck",
                effect=PolicyStatementEffect.ALLOW,
                principals=[
                    GetPolicyDocumentStatementPrincipalArgs(
                        type="Service",
                        identifiers=[FLOW_LOG_SERVICE],
                    )
                ],
                actions=["s3:GetBucketAcl"],
                resources=[logs.arn],
                conditions=[
                    GetPolicyDocumentStatementConditionArgs(
                        test="StringEquals",
                        variable="aws:SourceAccount",
                        values=[account_id],
                    ),
                    GetPolicyDocumentStatementConditionArgs(
                        test="ArnLike",
                        variable="aws:SourceArn",
                        values=[logs_source_arn],
                    ),
                ],
            ),
        ]
    ).json,
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
    domain=BUDDYBIRD_ROOT_DOMAIN,
    zone_id=CLOUDFLARE_ZONE_ID,
    subnets=network.public_subnets,
    alb_security_group=network.alb_security_group,
    log_bucket=logs,
    log_prefix=ALB_LOG_PREFIX,
    log_bucket_policy=logs_policy,
)

ssm_instance = bastion(
    NAME_PREFIX,
    subnet=network.public_subnets[0],
    security_group=network.ssm_security_group,
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
pulumi.export("ssm_instance_id", ssm_instance.id)
pulumi.export("cluster_arn", serving.cluster.arn)
pulumi.export("alb_dns_name", serving.alb.dns_name)
pulumi.export("https_listener_arn", serving.https_listener.arn)
pulumi.export("cloudfront_certificate_arn", serving.cloudfront_certificate.arn)
