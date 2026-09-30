import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

from data import (
    Database,
    DatabaseArgs,
    DataBucket,
    DataBucketArgs,
    data_bucket_name,
)
from dns import cname_record
from messaging import (
    JUDGMENT_RESULT,
    MIMICRY_JUDGMENT,
    NOTIFICATION,
    PARROT_SOUND_DETECTION,
    PERIODIC_COMMAND,
    UPLOAD_CONFIRMATION,
    WITHDRAWAL,
)

API_CONTAINER_PORT = 8000
WEB_SERVICE_PORT = 3000
TASK_CPU = "256"
TASK_MEMORY = "512"
HEALTH_PATH = "/api/healthz"
API_PATH_PATTERN = "/api/*"
LOG_RETENTION_DAYS = 30
DEREGISTRATION_DELAY = 30
HEALTH_GRACE_SECONDS = 60
HEALTH_CHECK_INTERVAL = 10

DEFAULT_CAPACITY = "on-demand"
CAPACITY_STRATEGIES = {
    "on-demand": [("FARGATE", 0, 1)],
    "spot": [("FARGATE_SPOT", 0, 1)],
    "on-demand-with-spot": [("FARGATE", 1, 0), ("FARGATE_SPOT", 0, 1)],
}

S3_OBJECT_ACTIONS = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
S3_TAGGING_ACTIONS = ["s3:PutObjectTagging"]

MERGED_TASK_MEMORY = "1024"
AI_API_TASK_CPU = "2048"
AI_API_TASK_MEMORY = "4096"
AI_API_CONTAINER_NAME = "ai-api"
# ai-api 이미지의 헬스체크 명령. startPeriod는 모델 로딩 실측 후 조정한다.
AI_API_HEALTH_CHECK = {
    "command": ["CMD", "python", "-m", "app.health"],
    "interval": 15,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 120,
}
AI_API_WEBHOOK_VARIABLE = "ALERT_SLACK_WEBHOOK_URL"
AI_API_SOUND_KEY_PATTERN = "user/*/session/*"
AI_API_RECEIVE_QUEUE = PARROT_SOUND_DETECTION
AI_API_SEND_QUEUE = JUDGMENT_RESULT
CONSUMER_CONTAINER_NAME = "consumer"
CONSUMER_COMMAND = ["python", "-m", "app.consumer"]

API_SEND_QUEUES = [NOTIFICATION, WITHDRAWAL]
CONSUMER_RECEIVE_QUEUES = [
    UPLOAD_CONFIRMATION,
    JUDGMENT_RESULT,
    NOTIFICATION,
    WITHDRAWAL,
    PERIODIC_COMMAND,
]
CONSUMER_SEND_QUEUES = [
    PARROT_SOUND_DETECTION,
    MIMICRY_JUDGMENT,
    NOTIFICATION,
    WITHDRAWAL,
]
SQS_RECEIVE_ACTIONS = [
    "sqs:ReceiveMessage",
    "sqs:DeleteMessage",
    "sqs:ChangeMessageVisibility",
    "sqs:GetQueueAttributes",
]

KVS_CHANNEL_ACTIONS = [
    "kinesisvideo:CreateSignalingChannel",
    "kinesisvideo:DescribeSignalingChannel",
    "kinesisvideo:GetSignalingChannelEndpoint",
    "kinesisvideo:GetIceServerConfig",
    "kinesisvideo:ConnectAsMaster",
    "kinesisvideo:ConnectAsViewer",
    "kinesisvideo:DeleteSignalingChannel",
]

APP_SECRET_ENV_VARS = {
    "backoffice_password": "BACKOFFICE_PASSWORD",
    "supabase_secret_key": "SUPABASE_SECRET_KEY",
    "oauth_credentials_key": "OAUTH_CREDENTIALS_KEY",
    "google_client_secret": "GOOGLE_CLIENT_SECRET",
    "apple_private_key": "APPLE_PRIVATE_KEY",
    "kakao_admin_key": "KAKAO_ADMIN_KEY",
    "fcm_service_account_json": "FCM_SERVICE_ACCOUNT_JSON",
}

ROTATION_REDEPLOY_TIMEOUT_SECONDS = 10
ROTATION_REDEPLOY_CODE = """\
import os

import boto3

ecs = boto3.client("ecs")


def handler(event, context):
    for service in os.environ["SERVICES"].split(","):
        ecs.update_service(
            cluster=os.environ["CLUSTER"],
            service=service,
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


def fargate_task_definition(
    name: str,
    *,
    family: str,
    memory: str,
    container: pulumi.Output[str],
    execution_role_arn: pulumi.Input[str],
    task_role_arn: pulumi.Input[str] | None,
    opts: pulumi.ResourceOptions,
    cpu: str = TASK_CPU,
) -> aws.ecs.TaskDefinition:
    return aws.ecs.TaskDefinition(
        f"{name}-task-definition",
        family=family,
        cpu=cpu,
        memory=memory,
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


def capacity_provider_strategies(
    capacity: str,
) -> list[aws.ecs.ServiceCapacityProviderStrategyArgs]:
    return [
        aws.ecs.ServiceCapacityProviderStrategyArgs(
            capacity_provider=provider, base=base, weight=weight
        )
        for provider, base, weight in CAPACITY_STRATEGIES[capacity]
    ]


def background_service(
    name: str,
    *,
    service_name: str,
    container: pulumi.Output[str],
    execution_role_arn: pulumi.Input[str],
    task_role_arn: pulumi.Input[str],
    subnet_ids: pulumi.Input[Sequence[pulumi.Input[str]]],
    task_security_group_id: pulumi.Input[str],
    cluster_arn: pulumi.Input[str],
    capacity: str = DEFAULT_CAPACITY,
    cpu: str = TASK_CPU,
    memory: str = TASK_MEMORY,
    opts: pulumi.ResourceOptions,
) -> aws.ecs.Service:
    task_definition = fargate_task_definition(
        name,
        family=service_name,
        cpu=cpu,
        memory=memory,
        container=container,
        execution_role_arn=execution_role_arn,
        task_role_arn=task_role_arn,
        opts=opts,
    )

    return aws.ecs.Service(
        f"{name}-service",
        name=service_name,
        cluster=cluster_arn,
        task_definition=task_definition.arn,
        desired_count=0,
        force_new_deployment=True,
        capacity_provider_strategies=capacity_provider_strategies(capacity),
        deployment_circuit_breaker=aws.ecs.ServiceDeploymentCircuitBreakerArgs(
            enable=True, rollback=True
        ),
        network_configuration=aws.ecs.ServiceNetworkConfigurationArgs(
            subnets=subnet_ids,
            security_groups=[task_security_group_id],
            assign_public_ip=True,
        ),
        opts=pulumi.ResourceOptions.merge(
            opts,
            pulumi.ResourceOptions(ignore_changes=["taskDefinition", "desiredCount"]),
        ),
    )


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
    capacity: str = DEFAULT_CAPACITY,
    memory: str = TASK_MEMORY,
    opts: pulumi.ResourceOptions,
) -> aws.ecs.Service:
    replaceable = pulumi.ResourceOptions.merge(
        opts, pulumi.ResourceOptions(delete_before_replace=True)
    )

    task_definition = fargate_task_definition(
        name,
        family=service_name,
        memory=memory,
        container=container,
        execution_role_arn=execution_role_arn,
        task_role_arn=task_role_arn,
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
            interval=HEALTH_CHECK_INTERVAL,
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
        force_new_deployment=True,
        capacity_provider_strategies=capacity_provider_strategies(capacity),
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
    capacity: str = DEFAULT_CAPACITY


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
            capacity=args.capacity,
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
class AiApiArgs:
    service_name: str
    image: pulumi.Input[str]
    region: str
    data_bucket: aws.s3.Bucket
    queues: Mapping[str, aws.sqs.Queue]
    subnet_ids: pulumi.Input[Sequence[pulumi.Input[str]]]
    task_security_group_id: pulumi.Input[str]
    cluster_arn: pulumi.Input[str]
    env: str
    capacity: str = DEFAULT_CAPACITY
    slack_webhook_url: pulumi.Input[str] | None = None


class AiApi(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: AiApiArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:AiApi", name, None, opts)
        child = pulumi.ResourceOptions(parent=self)

        logs = log_group(name, log_group_name=f"/ecs/{args.service_name}", opts=child)

        execution = execution_role(
            name, role_name=f"{args.service_name}-exec", opts=child
        )

        task = aws.iam.Role(
            f"{name}-task-role",
            name=f"{args.service_name}-task",
            assume_role_policy=_assume_role_policy(),
            opts=pulumi.ResourceOptions.merge(
                child, pulumi.ResourceOptions(delete_before_replace=True)
            ),
        )

        receive_queue = args.queues[AI_API_RECEIVE_QUEUE]
        send_queue = args.queues[AI_API_SEND_QUEUE]

        aws.iam.RolePolicy(
            f"{name}-task-role-policy",
            role=task.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["s3:GetObject"],
                        resources=[
                            pulumi.Output.format(
                                "{0}/{1}",
                                args.data_bucket.arn,
                                AI_API_SOUND_KEY_PATTERN,
                            )
                        ],
                    ),
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=SQS_RECEIVE_ACTIONS,
                        resources=[receive_queue.arn],
                    ),
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["sqs:SendMessage"],
                        resources=[send_queue.arn],
                    ),
                ]
            ).json,
            opts=child,
        )

        webhook_parameter_arn: pulumi.Input[str] = ""
        if args.slack_webhook_url is not None:
            webhook_parameter = aws.ssm.Parameter(
                f"{name}-alert-webhook",
                name=f"/{args.service_name}/alert-slack-webhook-url",
                type=aws.ssm.ParameterType.SECURE_STRING,
                value=args.slack_webhook_url,
                opts=child,
            )
            webhook_parameter_arn = webhook_parameter.arn
            aws.iam.RolePolicy(
                f"{name}-exec-role-alert-webhook",
                role=execution.name,
                policy=aws.iam.get_policy_document_output(
                    statements=[
                        GetPolicyDocumentStatementArgs(
                            effect=PolicyStatementEffect.ALLOW,
                            actions=["ssm:GetParameters"],
                            resources=[webhook_parameter.arn],
                        )
                    ]
                ).json,
                opts=child,
            )

        container = pulumi.Output.all(
            image=args.image,
            log_group=logs.name,
            bucket_name=args.data_bucket.id,
            receive_queue_url=receive_queue.url,
            send_queue_url=send_queue.url,
            webhook_parameter_arn=webhook_parameter_arn,
        ).apply(
            lambda a: json.dumps(
                [
                    {
                        "name": AI_API_CONTAINER_NAME,
                        "image": a["image"],
                        "essential": True,
                        "healthCheck": AI_API_HEALTH_CHECK,
                        "environment": [
                            {"name": "APP_ENV", "value": args.env},
                            {"name": "AUDIO_S3_BUCKET", "value": a["bucket_name"]},
                            {
                                "name": _queue_url_variable(AI_API_RECEIVE_QUEUE),
                                "value": a["receive_queue_url"],
                            },
                            {
                                "name": _queue_url_variable(AI_API_SEND_QUEUE),
                                "value": a["send_queue_url"],
                            },
                        ],
                        "secrets": (
                            [
                                {
                                    "name": AI_API_WEBHOOK_VARIABLE,
                                    "valueFrom": a["webhook_parameter_arn"],
                                }
                            ]
                            if a["webhook_parameter_arn"]
                            else []
                        ),
                        "logConfiguration": {
                            "logDriver": "awslogs",
                            "options": {
                                "awslogs-group": a["log_group"],
                                "awslogs-region": args.region,
                                "awslogs-stream-prefix": AI_API_CONTAINER_NAME,
                            },
                        },
                    }
                ]
            )
        )

        self.service = background_service(
            name,
            service_name=args.service_name,
            container=container,
            execution_role_arn=execution.arn,
            task_role_arn=task.arn,
            subnet_ids=args.subnet_ids,
            task_security_group_id=args.task_security_group_id,
            cluster_arn=args.cluster_arn,
            capacity=args.capacity,
            cpu=AI_API_TASK_CPU,
            memory=AI_API_TASK_MEMORY,
            opts=child,
        )

        self.register_outputs({"service": self.service})


def _queue_url_variable(suffix: str) -> str:
    return f"SQS_{suffix.upper().replace('-', '_')}_QUEUE_URL"


def _container(
    args: ApiArgs,
    a: dict,
    *,
    container_name: str,
    log_group_name: str,
    port: int | None = None,
    command: Sequence[str] | None = None,
    essential: bool = True,
) -> dict:
    definition = {
        "name": container_name,
        "image": a["image"],
        "essential": essential,
        "environment": [
            {"name": "ENV", "value": args.env},
            {"name": "DB_HOST", "value": a["db_host"]},
            {"name": "DB_NAME", "value": a["db_name"]},
            {"name": "DB_USER", "value": a["db_user"]},
            {"name": "S3_BUCKET_NAME", "value": a["bucket_name"]},
            {"name": "FRONTEND_CORS_ORIGIN", "value": args.cors_origin},
            *[
                {"name": variable, "value": value}
                for variable, value in args.app_environment.items()
            ],
            *[
                {"name": _queue_url_variable(suffix), "value": url}
                for suffix, url in a["queue_urls"].items()
            ],
        ],
        "secrets": [
            {"name": "DB_PASSWORD", "valueFrom": f"{a['db_secret']}:password::"},
            *[
                {
                    "name": variable,
                    "valueFrom": f"{a['app_secret']}:{key}::",
                }
                for key, variable in APP_SECRET_ENV_VARS.items()
            ],
        ],
        "logConfiguration": {
            "logDriver": "awslogs",
            "options": {
                "awslogs-group": log_group_name,
                "awslogs-region": args.region,
                "awslogs-stream-prefix": container_name,
            },
        },
    }
    if port is not None:
        definition["portMappings"] = [{"containerPort": port, "protocol": "tcp"}]
    if command is not None:
        definition["command"] = list(command)
    if not essential:
        definition["restartPolicy"] = {"enabled": True}
    return definition


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
    app_secrets: Mapping[str, pulumi.Input[str]]
    app_environment: Mapping[str, str]
    readonly_db_password: pulumi.Input[str]
    vpc_id: pulumi.Input[str]
    subnet_ids: pulumi.Input[Sequence[pulumi.Input[str]]]
    task_security_group_id: pulumi.Input[str]
    cluster_arn: pulumi.Input[str]
    listener_arn: pulumi.Input[str]
    name_prefix: str
    queues: Mapping[str, aws.sqs.Queue]
    dns_target: pulumi.Input[str] | None = None
    local_data_cors_origins: Sequence[str] | None = None
    capacity: str = DEFAULT_CAPACITY
    consumer_separate: bool = False


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
                bucket_name=data_bucket_name(env, args.account_id, args.region),
                cors_allowed_origins=args.data_cors_origins,
            ),
            child,
        )

        self.local_data = None
        if args.local_data_cors_origins is not None:
            self.local_data = DataBucket(
                f"{name}-local-data",
                DataBucketArgs(
                    bucket_name=data_bucket_name("local", args.account_id, args.region),
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
            description=f"buddybird-api {env} app secrets",
            recovery_window_in_days=0,
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.secretsmanager.SecretVersion(
            f"{name}-app-secret-version",
            secret_id=app_secret.id,
            secret_string=pulumi.Output.json_dumps(
                {key: args.app_secrets[key] for key in APP_SECRET_ENV_VARS}
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

        object_arn = pulumi.Output.format("{0}/*", self.data.bucket.arn)

        aws.iam.RolePolicy(
            f"{name}-task-role-s3",
            role=task.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=[*S3_OBJECT_ACTIONS, *S3_TAGGING_ACTIONS],
                        resources=[object_arn],
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

        aws.iam.RolePolicy(
            f"{name}-task-role-sqs",
            role=task.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["sqs:SendMessage"],
                        resources=[args.queues[q].arn for q in API_SEND_QUEUES],
                    )
                ]
            ).json,
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.iam.RolePolicy(
            f"{name}-task-role-kvs",
            role=task.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=KVS_CHANNEL_ACTIONS,
                        resources=[
                            (
                                f"arn:aws:kinesisvideo:{args.region}:{args.account_id}"
                                f":channel/{args.name_prefix}-*/*"
                            )
                        ],
                    )
                ]
            ).json,
            opts=pulumi.ResourceOptions(parent=self),
        )

        consumer_statements = [
            GetPolicyDocumentStatementArgs(
                effect=PolicyStatementEffect.ALLOW,
                actions=SQS_RECEIVE_ACTIONS,
                resources=[args.queues[q].arn for q in CONSUMER_RECEIVE_QUEUES],
            ),
            GetPolicyDocumentStatementArgs(
                effect=PolicyStatementEffect.ALLOW,
                actions=["sqs:SendMessage"],
                resources=[args.queues[q].arn for q in CONSUMER_SEND_QUEUES],
            ),
            GetPolicyDocumentStatementArgs(
                effect=PolicyStatementEffect.ALLOW,
                actions=[*S3_OBJECT_ACTIONS, *S3_TAGGING_ACTIONS],
                resources=[object_arn],
            ),
            GetPolicyDocumentStatementArgs(
                effect=PolicyStatementEffect.ALLOW,
                actions=["s3:ListBucket"],
                resources=[self.data.bucket.arn],
            ),
        ]

        consumer_logs = logs
        consumer_task = task
        if args.consumer_separate:
            consumer_logs = log_group(
                f"{name}-consumer",
                log_group_name=f"/ecs/{args.service_name}-consumer",
                opts=pulumi.ResourceOptions(parent=self),
            )
            consumer_task = aws.iam.Role(
                f"{name}-consumer-task-role",
                name=f"{args.service_name}-consumer-task",
                assume_role_policy=_assume_role_policy(),
                opts=pulumi.ResourceOptions.merge(
                    pulumi.ResourceOptions(parent=self),
                    pulumi.ResourceOptions(delete_before_replace=True),
                ),
            )

        aws.iam.RolePolicy(
            f"{name}-consumer-policy",
            role=consumer_task.name,
            policy=aws.iam.get_policy_document_output(
                statements=consumer_statements
            ).json,
            opts=pulumi.ResourceOptions(parent=self),
        )

        values = pulumi.Output.all(
            image=args.image,
            log_group=logs.name,
            consumer_log_group=consumer_logs.name,
            db_host=self.database.instance.address,
            db_name=self.database.instance.db_name,
            db_user=self.database.instance.username,
            bucket_name=self.data.bucket.id,
            db_secret=db_secret_arn,
            app_secret=app_secret.arn,
            queue_urls={suffix: queue.url for suffix, queue in args.queues.items()},
        )

        def api_container(a: dict) -> dict:
            return _container(
                args,
                a,
                container_name="api",
                log_group_name=a["log_group"],
                port=API_CONTAINER_PORT,
            )

        def consumer_container(a: dict, *, essential: bool) -> dict:
            return _container(
                args,
                a,
                container_name=CONSUMER_CONTAINER_NAME,
                log_group_name=a["consumer_log_group"],
                command=CONSUMER_COMMAND,
                essential=essential,
            )

        if args.consumer_separate:
            container = values.apply(lambda a: json.dumps([api_container(a)]))
        else:
            container = values.apply(
                lambda a: json.dumps(
                    [api_container(a), consumer_container(a, essential=False)]
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
            capacity=args.capacity,
            memory=TASK_MEMORY if args.consumer_separate else MERGED_TASK_MEMORY,
            opts=pulumi.ResourceOptions(parent=self),
        )

        services = [self.service]
        if args.consumer_separate:
            self.consumer_service = background_service(
                f"{name}-consumer",
                service_name=f"{args.service_name}-consumer",
                container=values.apply(
                    lambda a: json.dumps([consumer_container(a, essential=True)])
                ),
                execution_role_arn=execution.arn,
                task_role_arn=consumer_task.arn,
                subnet_ids=args.subnet_ids,
                task_security_group_id=args.task_security_group_id,
                cluster_arn=args.cluster_arn,
                opts=pulumi.ResourceOptions(parent=self),
            )
            services.append(self.consumer_service)

        self._rotation_redeploy(name, args, db_secret_arn, services)

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

    def _rotation_redeploy(
        self,
        name: str,
        args: ApiArgs,
        secret_arn: pulumi.Input[str],
        services: Sequence[aws.ecs.Service],
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
                        resources=[service.id for service in services],
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
                variables={
                    "CLUSTER": args.cluster_arn,
                    "SERVICES": pulumi.Output.all(
                        *[service.name for service in services]
                    ).apply(",".join),
                }
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
