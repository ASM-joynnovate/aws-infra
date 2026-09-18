from collections.abc import Sequence
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

DATA_BUCKET_PREFIX = "jn-buddybird-v1"
ROOT_DOMAIN = "buddybird.xyz"

CORS_ORIGINS = {
    "local": ["http://localhost:3000"],
    "dev": [f"https://dev.{ROOT_DOMAIN}", f"https://dev-backoffice.{ROOT_DOMAIN}"],
    "prod": [f"https://{ROOT_DOMAIN}", f"https://backoffice.{ROOT_DOMAIN}"],
}

DB_ENGINE_VERSION = "17"
DB_STORAGE_GB = 20
DB_BACKUP_RETENTION_DAYS = 7
DB_NAME = "buddybird"
DB_USER = "buddybird"


def harden_bucket(
    name: str, bucket: aws.s3.Bucket, opts: pulumi.ResourceOptions
) -> None:
    aws.s3.BucketServerSideEncryptionConfiguration(
        f"{name}-encryption",
        bucket=bucket.id,
        rules=[
            aws.s3.BucketServerSideEncryptionConfigurationRuleArgs(
                apply_server_side_encryption_by_default=aws.s3.BucketServerSideEncryptionConfigurationRuleApplyServerSideEncryptionByDefaultArgs(
                    sse_algorithm="AES256"
                )
            )
        ],
        opts=opts,
    )

    aws.s3.BucketPublicAccessBlock(
        f"{name}-public-access-block",
        bucket=bucket.id,
        block_public_acls=True,
        block_public_policy=True,
        ignore_public_acls=True,
        restrict_public_buckets=True,
        opts=opts,
    )

    aws.s3.BucketOwnershipControls(
        f"{name}-ownership",
        bucket=bucket.id,
        rule=aws.s3.BucketOwnershipControlsRuleArgs(
            object_ownership="BucketOwnerEnforced"
        ),
        opts=opts,
    )


@dataclass(frozen=True)
class DataBucketArgs:
    bucket_name: str
    cors_allowed_origins: Sequence[str]
    previous_name: str


class DataBucket(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: DataBucketArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:DataBucket", name, None, opts)
        previous = args.previous_name

        self.bucket = aws.s3.Bucket(
            f"{name}-bucket",
            bucket=args.bucket_name,
            opts=pulumi.ResourceOptions.merge(
                from_root(self, previous),
                pulumi.ResourceOptions(protect=True),
            ),
        )

        harden_bucket(name, self.bucket, from_root(self, previous))

        aws.s3.BucketVersioning(
            f"{name}-versioning",
            bucket=self.bucket.id,
            versioning_configuration=aws.s3.BucketVersioningVersioningConfigurationArgs(
                status="Enabled"
            ),
            opts=from_root(self, previous),
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
                    id="expire-noncurrent-versions",
                    status="Enabled",
                    filter=aws.s3.BucketLifecycleConfigurationRuleFilterArgs(),
                    noncurrent_version_expiration=aws.s3.BucketLifecycleConfigurationRuleNoncurrentVersionExpirationArgs(
                        noncurrent_days=30
                    ),
                ),
            ],
            opts=from_root(self, previous),
        )

        aws.s3.BucketPolicy(
            f"{name}-policy",
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
            opts=from_root(self, f"{previous}-tls-only"),
        )

        aws.s3.BucketCorsConfiguration(
            f"{name}-cors",
            bucket=self.bucket.id,
            cors_rules=[
                aws.s3.BucketCorsConfigurationCorsRuleArgs(
                    allowed_headers=["*"],
                    allowed_methods=["GET"],
                    allowed_origins=list(args.cors_allowed_origins),
                    expose_headers=["Content-Length", "Content-Type"],
                )
            ],
            opts=from_root(self, previous),
        )

        self.register_outputs({"bucket": self.bucket})


@dataclass(frozen=True)
class DatabaseArgs:
    env: str
    identifier: str
    subnet_group_name: pulumi.Input[str]
    security_group_id: pulumi.Input[str]
    deletion_protection: bool
    readonly_secret_name: str
    readonly_password: pulumi.Input[str]


class Database(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: DatabaseArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:Database", name, None, opts)

        self.instance = aws.rds.Instance(
            f"{name}-instance",
            identifier=args.identifier,
            engine=aws.rds.EngineType.POSTGRES,
            engine_version=DB_ENGINE_VERSION,
            instance_class=aws.rds.InstanceType.T4_G_MICRO,
            allocated_storage=DB_STORAGE_GB,
            storage_type=aws.rds.StorageType.GP3,
            storage_encrypted=True,
            db_name=DB_NAME,
            username=DB_USER,
            manage_master_user_password=True,
            db_subnet_group_name=args.subnet_group_name,
            vpc_security_group_ids=[args.security_group_id],
            publicly_accessible=False,
            backup_retention_period=DB_BACKUP_RETENTION_DAYS,
            auto_minor_version_upgrade=True,
            skip_final_snapshot=not args.deletion_protection,
            final_snapshot_identifier=(
                f"{args.identifier}-final" if args.deletion_protection else None
            ),
            deletion_protection=args.deletion_protection,
            opts=pulumi.ResourceOptions.merge(
                from_root(self, f"db-{args.env}"),
                pulumi.ResourceOptions(protect=True),
            ),
        )

        self.readonly_secret = aws.secretsmanager.Secret(
            f"{name}-readonly-secret",
            name=args.readonly_secret_name,
            description=f"buddybird-api {args.env} read-only database user",
            recovery_window_in_days=0,
            opts=from_root(self, f"db-readonly-{args.env}"),
        )

        aws.secretsmanager.SecretVersion(
            f"{name}-readonly-secret-version",
            secret_id=self.readonly_secret.id,
            secret_string=pulumi.Output.json_dumps(
                {"password": args.readonly_password}
            ),
            opts=from_root(self, f"db-readonly-{args.env}"),
        )

        self.register_outputs(
            {"instance": self.instance, "readonly_secret": self.readonly_secret}
        )
