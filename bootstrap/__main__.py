import pulumi
import pulumi_aws as aws

from ci import CiRoles

NAME_PREFIX = "jn"
NONCURRENT_RETENTION_DAYS = 90

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id
bucket_name = f"{NAME_PREFIX}-state-{account_id}-{region}-an"
key_alias = f"alias/{NAME_PREFIX}-pulumi-secrets"

state = aws.s3.Bucket(
    "state",
    bucket=bucket_name,
    bucket_namespace="account-regional",
    opts=pulumi.ResourceOptions(protect=True),
)

versioning = aws.s3.BucketVersioning(
    "state",
    bucket=state.id,
    versioning_configuration=aws.s3.BucketVersioningVersioningConfigurationArgs(
        status="Enabled"
    )
)

aws.s3.BucketServerSideEncryptionConfiguration(
    "state",
    bucket=state.id,
    rules=[
        aws.s3.BucketServerSideEncryptionConfigurationRuleArgs(
            apply_server_side_encryption_by_default=aws.s3.BucketServerSideEncryptionConfigurationRuleApplyServerSideEncryptionByDefaultArgs(
                sse_algorithm="AES256"
            )
        )
    ]
)

aws.s3.BucketPublicAccessBlock(
    "state",
    bucket=state.id,
    block_public_acls=True,
    block_public_policy=True,
    ignore_public_acls=True,
    restrict_public_buckets=True
)

aws.s3.BucketOwnershipControls(
    "state",
    bucket=state.id,
    rule=aws.s3.BucketOwnershipControlsRuleArgs(
        object_ownership="BucketOwnerEnforced"
    )
)

aws.s3.BucketLifecycleConfiguration(
    "state",
    bucket=state.id,
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
                noncurrent_days=NONCURRENT_RETENTION_DAYS
            ),
        ),
    ],
    opts=pulumi.ResourceOptions(depends_on=[versioning])
)

aws.s3.BucketPolicy(
    "state-tls-only",
    bucket=state.id,
    policy=pulumi.Output.json_dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "DenyInsecureTransport",
                    "Effect": "Deny",
                    "Principal": "*",
                    "Action": "s3:*",
                    "Resource": [
                        state.arn,
                        pulumi.Output.format("{0}/*", state.arn),
                    ],
                    "Condition": {"Bool": {"aws:SecureTransport": "false"}},
                }
            ],
        }
    ),
)

secrets_key = aws.kms.Key(
    "pulumi-secrets",
    description="Pulumi 스택 secret 암호화",
    deletion_window_in_days=7,
    enable_key_rotation=True,
    opts=pulumi.ResourceOptions(protect=True),
)

aws.kms.Alias(
    "pulumi-secrets",
    name=key_alias,
    target_key_id=secrets_key.key_id,
)

ci = CiRoles(
    "ci",
    account_id=account_id,
    state_bucket_arn=state.arn,
    secrets_key_arn=secrets_key.arn,
)

pulumi.export("state_bucket_name", state.id)
pulumi.export("state_bucket_arn", state.arn)
pulumi.export("secrets_key_arn", secrets_key.arn)
pulumi.export("secrets_key_alias", key_alias)
pulumi.export("region", region)
pulumi.export("ci_preview_role_arn", ci.preview_role.arn)
pulumi.export("ci_pulumi_role_arn", ci.pulumi_role.arn)