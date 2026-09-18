from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)


@dataclass(frozen=True)
class StateBucketArgs:
    bucket_name: str
    noncurrent_retention_days: int


class StateBucket(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: StateBucketArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:bootstrap:StateBucket", name, None, opts)

        self.bucket = aws.s3.Bucket(
            f"{name}-bucket",
            bucket=args.bucket_name,
            bucket_namespace="account-regional",
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(protect=True),
            ),
        )

        versioning = aws.s3.BucketVersioning(
            f"{name}-versioning",
            bucket=self.bucket.id,
            versioning_configuration=aws.s3.BucketVersioningVersioningConfigurationArgs(
                status="Enabled"
            ),
            opts=pulumi.ResourceOptions(parent=self),
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
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.s3.BucketPublicAccessBlock(
            f"{name}-public-access-block",
            bucket=self.bucket.id,
            block_public_acls=True,
            block_public_policy=True,
            ignore_public_acls=True,
            restrict_public_buckets=True,
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.s3.BucketOwnershipControls(
            f"{name}-ownership",
            bucket=self.bucket.id,
            rule=aws.s3.BucketOwnershipControlsRuleArgs(
                object_ownership="BucketOwnerEnforced"
            ),
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.s3.BucketLifecycleConfiguration(
            f"{name}-lifecycle",
            bucket=self.bucket.id,
            rules=[
                aws.s3.BucketLifecycleConfigurationRuleArgs(
                    id="abort-incomplete-multipart-upload",
                    status="Enabled",
                    filter=aws.s3.BucketLifecycleConfigurationRuleFilterArgs(),
                    abort_incomplete_multipart_upload=aws.s3.BucketLifecycleConfigurationRuleAbortIncompleteMultipartUploadArgs(
                        days_after_initiation=7
                    ),
                ),
                aws.s3.BucketLifecycleConfigurationRuleArgs(
                    id="expire-noncurrent-state",
                    status="Enabled",
                    filter=aws.s3.BucketLifecycleConfigurationRuleFilterArgs(),
                    noncurrent_version_expiration=aws.s3.BucketLifecycleConfigurationRuleNoncurrentVersionExpirationArgs(
                        noncurrent_days=args.noncurrent_retention_days
                    ),
                ),
            ],
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(depends_on=[versioning]),
            ),
        )

        aws.s3.BucketPolicy(
            f"{name}-tls-only-policy",
            bucket=self.bucket.id,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        sid="DenyInsecureTransport",
                        effect=PolicyStatementEffect.DENY,
                        principals=[
                            GetPolicyDocumentStatementPrincipalArgs(
                                type="*",
                                identifiers=["*"],
                            )
                        ],
                        actions=["s3:*"],
                        resources=[
                            self.bucket.arn,
                            pulumi.Output.format("{0}/*", self.bucket.arn),
                        ],
                        conditions=[
                            GetPolicyDocumentStatementConditionArgs(
                                test="Bool",
                                variable="aws:SecureTransport",
                                values=["false"],
                            )
                        ],
                    )
                ]
            ).json,
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.register_outputs({"bucket": self.bucket})
