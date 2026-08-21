import pulumi
import pulumi_aws as aws

DB_ENGINE_VERSION = "17"
DB_INSTANCE_CLASS = "db.t4g.micro"
DB_STORAGE_GB = 20
DB_BACKUP_RETENTION_DAYS = 7
DB_NAME = "buddybird"
DB_USER = "buddybird"


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
