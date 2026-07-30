import pulumi
import pulumi_aws as aws

NAME_PREFIX = "jn-buddybird-v1"

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id


def data_bucket(env: str) -> aws.s3.Bucket:
    name = f"data-{env}"

    bucket = aws.s3.Bucket(
        name,
        bucket=f"{NAME_PREFIX}-{name}-{account_id}-{region}",
    )

    aws.s3.BucketServerSideEncryptionConfiguration(
        name,
        bucket=bucket.id,
        rules=[
            aws.s3.BucketServerSideEncryptionConfigurationRuleArgs(
                apply_server_side_encryption_by_default=aws.s3.BucketServerSideEncryptionConfigurationRuleApplyServerSideEncryptionByDefaultArgs(
                    sse_algorithm="AES256"
                )
            )
        ]
    )

    aws.s3.BucketPublicAccessBlock(
        name,
        bucket=bucket.id,
        block_public_acls=True,
        block_public_policy=True,
        ignore_public_acls=True,
        restrict_public_buckets=True
    )

    aws.s3.BucketOwnershipControls(
        name,
        bucket=bucket.id,
        rule=aws.s3.BucketOwnershipControlsRuleArgs(
            object_ownership="BucketOwnerEnforced"
        )
    )

    aws.s3.BucketLifecycleConfiguration(
        name,
        bucket=bucket.id,
        rules=[
            aws.s3.BucketLifecycleConfigurationRuleArgs(
                id="abort-incomplete-multipart-upload",
                status="Enabled",
                filter=aws.s3.BucketLifecycleConfigurationRuleFilterArgs(),
                abort_incomplete_multipart_upload=aws.s3.BucketLifecycleConfigurationRuleAbortIncompleteMultipartUploadArgs(
                    days_after_initiation=7
                ),
            ),
        ]
    )

    aws.s3.BucketPolicy(
        f"{name}-tls-only",
        bucket=bucket.id,
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
                            bucket.arn,
                            pulumi.Output.format("{0}/*", bucket.arn),
                        ],
                        "Condition": {"Bool": {"aws:SecureTransport": "false"}},
                    }
                ],
            }
        ),
    )

    return bucket


dev = data_bucket("dev")
local = data_bucket("local")

pulumi.export("data_dev_bucket_name", dev.id)
pulumi.export("data_local_bucket_name", local.id)