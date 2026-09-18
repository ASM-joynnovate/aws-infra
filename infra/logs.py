from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

from moved import from_root

ALB_LOG_SERVICE = "logdelivery.elasticloadbalancing.amazonaws.com"
FLOW_LOG_SERVICE = "delivery.logs.amazonaws.com"

PREVIOUS_NAME = "logs"


@dataclass
class LoggingArgs:
    bucket_name: str
    account_id: str
    region: str
    alb_log_prefix: str
    retention_days: int


class Logging(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: LoggingArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:infra:Logging", name, None, opts)
        logs_source_arn = f"arn:aws:logs:{args.region}:{args.account_id}:*"

        self.bucket = aws.s3.Bucket(
            f"{name}-bucket",
            bucket=args.bucket_name,
            opts=pulumi.ResourceOptions.merge(
                from_root(self, PREVIOUS_NAME),
                pulumi.ResourceOptions(protect=True),
            ),
        )

        aws.s3.BucketServerSideEncryptionConfiguration(
            f"{name}-encryption",
            bucket=self.bucket.id,
            rules=[
                aws.s3.BucketServerSideEncryptionConfigurationRuleArgs(
                    apply_server_side_encryption_by_default=aws.s3.BucketServerSideEncryptionConfigurationRuleApplyServerSideEncryptionByDefaultArgs(
                        sse_algorithm="AES256"
                    )
                )
            ],
            opts=from_root(self, PREVIOUS_NAME),
        )

        aws.s3.BucketPublicAccessBlock(
            f"{name}-public-access-block",
            bucket=self.bucket.id,
            block_public_acls=True,
            block_public_policy=True,
            ignore_public_acls=True,
            restrict_public_buckets=True,
            opts=from_root(self, PREVIOUS_NAME),
        )

        aws.s3.BucketLifecycleConfiguration(
            f"{name}-lifecycle",
            bucket=self.bucket.id,
            rules=[
                aws.s3.BucketLifecycleConfigurationRuleArgs(
                    id="expire-logs",
                    status="Enabled",
                    filter=aws.s3.BucketLifecycleConfigurationRuleFilterArgs(),
                    expiration=aws.s3.BucketLifecycleConfigurationRuleExpirationArgs(
                        days=args.retention_days
                    ),
                )
            ],
            opts=from_root(self, PREVIOUS_NAME),
        )

        self.policy = aws.s3.BucketPolicy(
            f"{name}-policy",
            bucket=self.bucket.id,
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
                                "{0}/{1}/AWSLogs/{2}/*",
                                self.bucket.arn,
                                args.alb_log_prefix,
                                args.account_id,
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
                        resources=[pulumi.Output.format("{0}/*", self.bucket.arn)],
                        conditions=[
                            GetPolicyDocumentStatementConditionArgs(
                                test="StringEquals",
                                variable="aws:SourceAccount",
                                values=[args.account_id],
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
                        resources=[self.bucket.arn],
                        conditions=[
                            GetPolicyDocumentStatementConditionArgs(
                                test="StringEquals",
                                variable="aws:SourceAccount",
                                values=[args.account_id],
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
            opts=from_root(self, PREVIOUS_NAME),
        )

        self.register_outputs({"bucket": self.bucket, "policy": self.policy})
