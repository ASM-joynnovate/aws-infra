import pulumi
import pulumi_aws as aws

NAME_PREFIX = "jn-buddybird-v1"
DOMAIN = "buddybird.xyz"

CORS_ORIGINS = {
    "local": ["http://localhost:3000"],
    "dev": [f"https://dev.{DOMAIN}", f"https://dev-backoffice.{DOMAIN}"],
    "prod": [f"https://{DOMAIN}", f"https://backoffice.{DOMAIN}"],
}

DB_ENGINE_VERSION = "17"
DB_INSTANCE_CLASS = "db.t4g.micro"
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
        engine="postgres",
        engine_version=DB_ENGINE_VERSION,
        instance_class=DB_INSTANCE_CLASS,
        allocated_storage=DB_STORAGE_GB,
        storage_type="gp3",
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
