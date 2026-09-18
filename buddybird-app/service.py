import json
from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

from data import (
    DATA_BUCKET_PREFIX,
    Database,
    DatabaseArgs,
    DataBucket,
    DataBucketArgs,
)
from dns import cname_record

API_CONTAINER_PORT = 8000
WEB_SERVICE_PORT = 3000
TASK_CPU = "256"
TASK_MEMORY = "512"
HEALTH_PATH = "/api/healthz"
API_PATH_PATTERN = "/api/*"
LOG_RETENTION_DAYS = 30
DEREGISTRATION_DELAY = 30
HEALTH_GRACE_SECONDS = 60

AUTH_ALGORITHM = "HS256"
AUTH_ACCESS_TOKEN_EXPIRE_MINUTES = 10080
AUTH_REFRESH_TOKEN_EXPIRE_MINUTES = 20160

S3_OBJECT_ACTIONS = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]

ROTATION_REDEPLOY_TIMEOUT_SECONDS = 10
ROTATION_REDEPLOY_CODE = """\
import os

import boto3

ecs = boto3.client("ecs")


def handler(event, context):
    ecs.update_service(
        cluster=os.environ["CLUSTER"],
        service=os.environ["SERVICE"],
        forceNewDeployment=True,
    )
"""


def _assume_role_policy() -> str:
    return aws.iam.get_policy_document(
        statements=[
            GetPolicyDocumentStatementArgs(
                effect=PolicyStatementEffect.ALLOW,
                actions=["sts:AssumeRole"],
                principals=[
                    GetPolicyDocumentStatementPrincipalArgs(
                        type="Service", identifiers=["ecs-tasks.amazonaws.com"]
                    )
                ],
            )
        ]
    ).json


def log_group(
    name: str, *, log_group_name: str, opts: pulumi.ResourceOptions
) -> aws.cloudwatch.LogGroup:
    return aws.cloudwatch.LogGroup(
        f"{name}-log-group",
        name=log_group_name,
        retention_in_days=LOG_RETENTION_DAYS,
        opts=pulumi.ResourceOptions.merge(
            opts, pulumi.ResourceOptions(delete_before_replace=True)
        ),
    )


def execution_role(
    name: str, *, role_name: str, opts: pulumi.ResourceOptions
) -> aws.iam.Role:
    role = aws.iam.Role(
        f"{name}-exec-role",
        name=role_name,
        assume_role_policy=_assume_role_policy(),
        opts=pulumi.ResourceOptions.merge(
            opts, pulumi.ResourceOptions(delete_before_replace=True)
        ),
    )

    aws.iam.RolePolicyAttachment(
        f"{name}-exec-role-managed",
        role=role.name,
        policy_arn=aws.iam.ManagedPolicy.AMAZON_ECS_TASK_EXECUTION_ROLE_POLICY,
        opts=opts,
    )

    return role


def fargate_service(
    name: str,
    *,
    service_name: str,
    target_group_name: str,
    container_name: str,
    port: int,
    container: pulumi.Output[str],
    execution_role_arn: pulumi.Input[str],
    task_role_arn: pulumi.Input[str] | None = None,
    vpc_id: pulumi.Input[str],
    subnet_ids: pulumi.Input[Sequence[pulumi.Input[str]]],
    task_security_group_id: pulumi.Input[str],
    cluster_arn: pulumi.Input[str],
    listener_arn: pulumi.Input[str],
    hostname: str,
    priority: int,
    path_pattern: str | None = None,
    opts: pulumi.ResourceOptions,
) -> aws.ecs.Service:
    replaceable = pulumi.ResourceOptions.merge(
        opts, pulumi.ResourceOptions(delete_before_replace=True)
    )

    task_definition = aws.ecs.TaskDefinition(
        f"{name}-task-definition",
        family=service_name,
        cpu=TASK_CPU,
        memory=TASK_MEMORY,
        network_mode="awsvpc",
        requires_compatibilities=["FARGATE"],
        runtime_platform=aws.ecs.TaskDefinitionRuntimePlatformArgs(
            cpu_architecture="ARM64",
            operating_system_family="LINUX",
        ),
        execution_role_arn=execution_role_arn,
        task_role_arn=task_role_arn,
        container_definitions=container,
        opts=opts,
    )

    target_group = aws.lb.TargetGroup(
        f"{name}-target-group",
        name=target_group_name,
        port=port,
        protocol="HTTP",
        target_type="ip",
        vpc_id=vpc_id,
        deregistration_delay=DEREGISTRATION_DELAY,
        health_check=aws.lb.TargetGroupHealthCheckArgs(
            path=HEALTH_PATH,
            matcher="200",
            interval=30,
            timeout=5,
            healthy_threshold=2,
            unhealthy_threshold=3,
        ),
        opts=replaceable,
    )

    conditions = [
        aws.lb.ListenerRuleConditionArgs(
            host_header=aws.lb.ListenerRuleConditionHostHeaderArgs(values=[hostname])
        ),
    ]
    if path_pattern:
        conditions.append(
            aws.lb.ListenerRuleConditionArgs(
                path_pattern=aws.lb.ListenerRuleConditionPathPatternArgs(
                    values=[path_pattern]
                )
            )
        )

    aws.lb.ListenerRule(
        f"{name}-listener-rule",
        listener_arn=listener_arn,
        priority=priority,
        conditions=conditions,
        actions=[
            aws.lb.ListenerRuleActionArgs(
                type="forward", target_group_arn=target_group.arn
            )
        ],
        opts=replaceable,
    )

    return aws.ecs.Service(
        f"{name}-service",
        name=service_name,
        cluster=cluster_arn,
        task_definition=task_definition.arn,
        desired_count=1,
        launch_type="FARGATE",
        health_check_grace_period_seconds=HEALTH_GRACE_SECONDS,
        deployment_circuit_breaker=aws.ecs.ServiceDeploymentCircuitBreakerArgs(
            enable=True, rollback=True
        ),
        network_configuration=aws.ecs.ServiceNetworkConfigurationArgs(
            subnets=subnet_ids,
            security_groups=[task_security_group_id],
            assign_public_ip=True,
        ),
        load_balancers=[
            aws.ecs.ServiceLoadBalancerArgs(
                target_group_arn=target_group.arn,
                container_name=container_name,
                container_port=port,
            )
        ],
        opts=pulumi.ResourceOptions.merge(
            opts,
            pulumi.ResourceOptions(ignore_changes=["taskDefinition", "desiredCount"]),
        ),
    )


@dataclass(frozen=True)
class WebServiceArgs:
    service: str
    service_name: str
    target_group_name: str
    image: pulumi.Input[str]
    region: str
    hostname: str
    priority: int
    dns_target: pulumi.Input[str]
    vpc_id: pulumi.Input[str]
    subnet_ids: pulumi.Input[Sequence[pulumi.Input[str]]]
    task_security_group_id: pulumi.Input[str]
    cluster_arn: pulumi.Input[str]
    listener_arn: pulumi.Input[str]


class WebService(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: WebServiceArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:WebService", name, None, opts)

        logs = log_group(
            name,
            log_group_name=f"/ecs/{args.service_name}",
            opts=pulumi.ResourceOptions(parent=self),
        )

        execution = execution_role(
            name,
            role_name=f"{args.service_name}-exec",
            opts=pulumi.ResourceOptions(parent=self),
        )

        container = pulumi.Output.all(image=args.image, log_group=logs.name).apply(
            lambda a: json.dumps(
                [
                    {
                        "name": args.service,
                        "image": a["image"],
                        "essential": True,
                        "portMappings": [
                            {"containerPort": WEB_SERVICE_PORT, "protocol": "tcp"}
                        ],
                        "logConfiguration": {
                            "logDriver": "awslogs",
                            "options": {
                                "awslogs-group": a["log_group"],
                                "awslogs-region": args.region,
                                "awslogs-stream-prefix": args.service,
                            },
                        },
                    }
                ]
            )
        )

        self.service = fargate_service(
            name,
            service_name=args.service_name,
            target_group_name=args.target_group_name,
            container_name=args.service,
            port=WEB_SERVICE_PORT,
            container=container,
            execution_role_arn=execution.arn,
            vpc_id=args.vpc_id,
            subnet_ids=args.subnet_ids,
            task_security_group_id=args.task_security_group_id,
            cluster_arn=args.cluster_arn,
            listener_arn=args.listener_arn,
            hostname=args.hostname,
            priority=args.priority,
            opts=pulumi.ResourceOptions(parent=self),
        )

        cname_record(
            f"{name}-dns",
            hostname=args.hostname,
            target=args.dns_target,
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.register_outputs({"service": self.service})


@dataclass(frozen=True)
class ApiArgs:
    env: str
    service_name: str
    account_id: str
    region: str
    image: pulumi.Input[str]
    hostname: str
    priority: int
    cors_origin: str
    data_cors_origins: Sequence[str]
    deletion_protection: bool
    subnet_group_name: pulumi.Input[str]
    db_security_group_id: pulumi.Input[str]
    access_token_key: pulumi.Input[str]
    refresh_token_key: pulumi.Input[str]
    backoffice_password: pulumi.Input[str]
    readonly_db_password: pulumi.Input[str]
    vpc_id: pulumi.Input[str]
    subnet_ids: pulumi.Input[Sequence[pulumi.Input[str]]]
    task_security_group_id: pulumi.Input[str]
    cluster_arn: pulumi.Input[str]
    listener_arn: pulumi.Input[str]
    dns_target: pulumi.Input[str] | None = None
    local_data_cors_origins: Sequence[str] | None = None


class Api(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: ApiArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:Api", name, None, opts)
        child = pulumi.ResourceOptions(parent=self)
        env = args.env

        self.data = DataBucket(
            f"{name}-data",
            DataBucketArgs(
                bucket_name=self._data_bucket_name(env, args),
                cors_allowed_origins=args.data_cors_origins,
            ),
            child,
        )

        self.local_data = None
        if args.local_data_cors_origins is not None:
            self.local_data = DataBucket(
                f"{name}-local-data",
                DataBucketArgs(
                    bucket_name=self._data_bucket_name("local", args),
                    cors_allowed_origins=args.local_data_cors_origins,
                ),
                child,
            )

        self.database = Database(
            f"{name}-database",
            DatabaseArgs(
                env=env,
                identifier=args.service_name,
                subnet_group_name=args.subnet_group_name,
                security_group_id=args.db_security_group_id,
                deletion_protection=args.deletion_protection,
                readonly_secret_name=f"{args.service_name}-readonly",
                readonly_password=args.readonly_db_password,
            ),
            child,
        )
        db_secret_arn = self.database.instance.master_user_secrets[0].secret_arn

        app_secret = aws.secretsmanager.Secret(
            f"{name}-app-secret",
            name=args.service_name,
            description=f"buddybird-api {env} token signing keys",
            recovery_window_in_days=0,
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.secretsmanager.SecretVersion(
            f"{name}-app-secret-version",
            secret_id=app_secret.id,
            secret_string=pulumi.Output.json_dumps(
                {
                    "access_token_key": args.access_token_key,
                    "refresh_token_key": args.refresh_token_key,
                    "backoffice_password": args.backoffice_password,
                }
            ),
            opts=pulumi.ResourceOptions(parent=self),
        )

        logs = log_group(
            name,
            log_group_name=f"/ecs/{args.service_name}",
            opts=pulumi.ResourceOptions(parent=self),
        )

        execution = execution_role(
            name,
            role_name=f"{args.service_name}-exec",
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.iam.RolePolicy(
            f"{name}-exec-role-secrets",
            role=execution.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["secretsmanager:GetSecretValue"],
                        resources=[db_secret_arn, app_secret.arn],
                    )
                ]
            ).json,
            opts=pulumi.ResourceOptions(parent=self),
        )

        task = aws.iam.Role(
            f"{name}-task-role",
            name=f"{args.service_name}-task",
            assume_role_policy=_assume_role_policy(),
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        aws.iam.RolePolicy(
            f"{name}-task-role-s3",
            role=task.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=S3_OBJECT_ACTIONS,
                        resources=[pulumi.Output.format("{0}/*", self.data.bucket.arn)],
                    ),
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["s3:ListBucket"],
                        resources=[self.data.bucket.arn],
                    ),
                ]
            ).json,
            opts=pulumi.ResourceOptions(parent=self),
        )

        container = pulumi.Output.all(
            image=args.image,
            log_group=logs.name,
            db_host=self.database.instance.address,
            db_name=self.database.instance.db_name,
            db_user=self.database.instance.username,
            bucket_name=self.data.bucket.id,
            db_secret=db_secret_arn,
            app_secret=app_secret.arn,
        ).apply(
            lambda a: json.dumps(
                [
                    {
                        "name": "api",
                        "image": a["image"],
                        "essential": True,
                        "portMappings": [
                            {"containerPort": API_CONTAINER_PORT, "protocol": "tcp"}
                        ],
                        "environment": [
                            {"name": "BUDDYBIRD_ENV", "value": args.env},
                            {"name": "DB_HOST", "value": a["db_host"]},
                            {"name": "DB_NAME", "value": a["db_name"]},
                            {"name": "DB_USER", "value": a["db_user"]},
                            {"name": "S3_BUCKET_NAME", "value": a["bucket_name"]},
                            {
                                "name": "S3_BUCKET_DOMAIN",
                                "value": f"https://{a['bucket_name']}.s3.{args.region}.amazonaws.com",
                            },
                            {"name": "AUTH_ALGORITHM", "value": AUTH_ALGORITHM},
                            {
                                "name": "AUTH_ACCESS_TOKEN_EXPIRE_MINUTES",
                                "value": str(AUTH_ACCESS_TOKEN_EXPIRE_MINUTES),
                            },
                            {
                                "name": "AUTH_REFRESH_TOKEN_EXPIRE_MINUTES",
                                "value": str(AUTH_REFRESH_TOKEN_EXPIRE_MINUTES),
                            },
                            {"name": "FRONTEND_CORS_ORIGIN", "value": args.cors_origin},
                        ],
                        "secrets": [
                            {
                                "name": "DB_PASSWORD",
                                "valueFrom": f"{a['db_secret']}:password::",
                            },
                            {
                                "name": "AUTH_ACCESS_TOKEN_SECRET_KEY",
                                "valueFrom": f"{a['app_secret']}:access_token_key::",
                            },
                            {
                                "name": "AUTH_REFRESH_TOKEN_SECRET_KEY",
                                "valueFrom": f"{a['app_secret']}:refresh_token_key::",
                            },
                            {
                                "name": "BACKOFFICE_PASSWORD",
                                "valueFrom": f"{a['app_secret']}:backoffice_password::",
                            },
                        ],
                        "logConfiguration": {
                            "logDriver": "awslogs",
                            "options": {
                                "awslogs-group": a["log_group"],
                                "awslogs-region": args.region,
                                "awslogs-stream-prefix": "api",
                            },
                        },
                    }
                ]
            )
        )

        self.service = fargate_service(
            name,
            service_name=args.service_name,
            target_group_name=args.service_name,
            container_name="api",
            port=API_CONTAINER_PORT,
            container=container,
            execution_role_arn=execution.arn,
            task_role_arn=task.arn,
            vpc_id=args.vpc_id,
            subnet_ids=args.subnet_ids,
            task_security_group_id=args.task_security_group_id,
            cluster_arn=args.cluster_arn,
            listener_arn=args.listener_arn,
            hostname=args.hostname,
            priority=args.priority,
            path_pattern=API_PATH_PATTERN,
            opts=pulumi.ResourceOptions(parent=self),
        )

        self._rotation_redeploy(name, args, db_secret_arn)

        if args.dns_target is not None:
            cname_record(
                f"{name}-dns",
                hostname=args.hostname,
                target=args.dns_target,
                opts=pulumi.ResourceOptions(parent=self),
            )

        self.register_outputs(
            {
                "data": self.data,
                "local_data": self.local_data,
                "database": self.database,
                "service": self.service,
            }
        )

    @staticmethod
    def _data_bucket_name(bucket_env: str, args: ApiArgs) -> str:
        return f"{DATA_BUCKET_PREFIX}-data-{bucket_env}-{args.account_id}-{args.region}"

    def _rotation_redeploy(
        self, name: str, args: ApiArgs, secret_arn: pulumi.Input[str]
    ) -> None:
        child = pulumi.ResourceOptions(parent=self)
        replaceable = pulumi.ResourceOptions.merge(
            child, pulumi.ResourceOptions(delete_before_replace=True)
        )
        rotation_name = f"{args.service_name}-rotation"

        role = aws.iam.Role(
            f"{name}-rotation-role",
            name=rotation_name,
            description=f"buddybird-api {args.env} redeploy on RDS password rotation",
            assume_role_policy=aws.iam.get_policy_document(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["sts:AssumeRole"],
                        principals=[
                            GetPolicyDocumentStatementPrincipalArgs(
                                type="Service", identifiers=["lambda.amazonaws.com"]
                            )
                        ],
                    )
                ]
            ).json,
            opts=replaceable,
        )

        aws.iam.RolePolicyAttachment(
            f"{name}-rotation-role-logs",
            role=role.name,
            policy_arn=aws.iam.ManagedPolicy.AWS_LAMBDA_BASIC_EXECUTION_ROLE,
            opts=child,
        )

        aws.iam.RolePolicy(
            f"{name}-rotation-role-policy",
            role=role.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["ecs:UpdateService"],
                        resources=[self.service.id],
                    )
                ]
            ).json,
            opts=child,
        )

        function = aws.lambda_.Function(
            f"{name}-rotation-function",
            name=rotation_name,
            role=role.arn,
            runtime=aws.lambda_.Runtime.PYTHON3D14,
            handler="index.handler",
            timeout=ROTATION_REDEPLOY_TIMEOUT_SECONDS,
            code=pulumi.AssetArchive(
                {"index.py": pulumi.StringAsset(ROTATION_REDEPLOY_CODE)}
            ),
            environment=aws.lambda_.FunctionEnvironmentArgs(
                variables={"CLUSTER": args.cluster_arn, "SERVICE": self.service.name}
            ),
            opts=replaceable,
        )

        rule = aws.cloudwatch.EventRule(
            f"{name}-rotation-rule",
            name=rotation_name,
            event_pattern=pulumi.Output.json_dumps(
                {
                    "source": ["aws.secretsmanager"],
                    "detail-type": ["Secret Label Updated"],
                    "resources": [secret_arn],
                    "detail": {"labelUpdated": ["AWSCURRENT"]},
                }
            ),
            opts=replaceable,
        )

        aws.lambda_.Permission(
            f"{name}-rotation-permission",
            action="lambda:InvokeFunction",
            function=function.name,
            principal="events.amazonaws.com",
            source_arn=rule.arn,
            opts=child,
        )

        aws.cloudwatch.EventTarget(
            f"{name}-rotation-target",
            rule=rule.name,
            arn=function.arn,
            opts=child,
        )
