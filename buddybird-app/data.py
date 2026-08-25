import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

NAME_PREFIX = "jn-buddybird-v1"
ROOT_DOMAIN = "buddybird.xyz"

CORS_ORIGINS = {
    "local": ["http://localhost:3000"],
    "dev": [f"https://dev.{ROOT_DOMAIN}", f"https://dev-backoffice.{ROOT_DOMAIN}"],
    "prod": [f"https://{ROOT_DOMAIN}", f"https://backoffice.{ROOT_DOMAIN}"],
}


def _harden_bucket(logical_name: str, bucket: aws.s3.Bucket) -> None:
    aws.s3.BucketServerSideEncryptionConfiguration(
        logical_name,
        bucket=bucket.id,
        rules=[
            aws.s3.BucketServerSideEncryptionConfigurationRuleArgs(
                apply_server_side_encryption_by_default=aws.s3.BucketServerSideEncryptionConfigurationRuleApplyServerSideEncryptionByDefaultArgs(
                    sse_algorithm="AES256"
                )
            )
        ],
    )

    aws.s3.BucketPublicAccessBlock(
        logical_name,
        bucket=bucket.id,
        block_public_acls=True,
        block_public_policy=True,
        ignore_public_acls=True,
        restrict_public_buckets=True,
    )

    aws.s3.BucketOwnershipControls(
        logical_name,
        bucket=bucket.id,
        rule=aws.s3.BucketOwnershipControlsRuleArgs(
            object_ownership="BucketOwnerEnforced"
        ),
    )


DB_ENGINE_VERSION = "17"
DB_STORAGE_GB = 20
DB_BACKUP_RETENTION_DAYS = 7
DB_NAME = "buddybird"
DB_USER = "buddybird"


def data_bucket(
    env: str,
    *,
    account_id: str,
    region: str,
    cors_allowed_origins: list[str],
) -> aws.s3.Bucket:
    name = f"data-{env}"

    bucket = aws.s3.Bucket(
        name,
        bucket=f"{NAME_PREFIX}-{name}-{account_id}-{region}",
        opts=pulumi.ResourceOptions(protect=True),
    )

    _harden_bucket(name, bucket)

    aws.s3.BucketVersioning(
        name,
        bucket=bucket.id,
        versioning_configuration=aws.s3.BucketVersioningVersioningConfigurationArgs(
            status="Enabled"
        ),
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
            aws.s3.BucketLifecycleConfigurationRuleArgs(
                id="expire-noncurrent-versions",
                status="Enabled",
                filter=aws.s3.BucketLifecycleConfigurationRuleFilterArgs(),
                noncurrent_version_expiration=aws.s3.BucketLifecycleConfigurationRuleNoncurrentVersionExpirationArgs(
                    noncurrent_days=30
                ),
            ),
        ]
    )

    aws.s3.BucketPolicy(
        f"{name}-tls-only",
        bucket=bucket.id,
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
                        bucket.arn,
                        pulumi.Output.format("{0}/*", bucket.arn),
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
    )

    aws.s3.BucketCorsConfiguration(
        name,
        bucket=bucket.id,
        cors_rules=[
            aws.s3.BucketCorsConfigurationCorsRuleArgs(
                allowed_headers=["*"],
                allowed_methods=["GET"],
                allowed_origins=cors_allowed_origins,
                expose_headers=["Content-Length", "Content-Type"],
            )
        ],
    )

    return bucket


def db_subnet_group(name: str, subnet_ids) -> aws.rds.SubnetGroup:
    return aws.rds.SubnetGroup("main", name=name, subnet_ids=subnet_ids)


def database(
    env: str,
    *,
    name: str,
    subnet_group_name: pulumi.Input[str],
    security_group_id: pulumi.Input[str],
) -> aws.rds.Instance:
    is_prod = env == "prod"

    return aws.rds.Instance(
        f"db-{env}",
        identifier=name,
        engine=aws.rds.EngineType.POSTGRES,
        engine_version=DB_ENGINE_VERSION,
        instance_class=aws.rds.InstanceType.T4_G_MICRO,
        allocated_storage=DB_STORAGE_GB,
        storage_type=aws.rds.StorageType.GP3,
        storage_encrypted=True,
        db_name=DB_NAME,
        username=DB_USER,
        manage_master_user_password=True,
        db_subnet_group_name=subnet_group_name,
        vpc_security_group_ids=[security_group_id],
        publicly_accessible=False,
        backup_retention_period=DB_BACKUP_RETENTION_DAYS,
        auto_minor_version_upgrade=True,
        skip_final_snapshot=not is_prod,
        final_snapshot_identifier=f"{name}-final" if is_prod else None,
        deletion_protection=is_prod,
        opts=pulumi.ResourceOptions(protect=is_prod),
    )


def app_secret(
    env: str,
    *,
    name: str,
    access_token_key: pulumi.Input[str],
    refresh_token_key: pulumi.Input[str],
    backoffice_password: pulumi.Input[str],
) -> aws.secretsmanager.Secret:
    secret = aws.secretsmanager.Secret(
        f"app-{env}",
        name=name,
        description=f"buddybird-api {env} token signing keys",
        recovery_window_in_days=0,
    )

    aws.secretsmanager.SecretVersion(
        f"app-{env}",
        secret_id=secret.id,
        secret_string=pulumi.Output.json_dumps(
            {
                "access_token_key": access_token_key,
                "refresh_token_key": refresh_token_key,
                "backoffice_password": backoffice_password,
            }
        ),
    )

    return secret
