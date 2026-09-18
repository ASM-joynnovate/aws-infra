import json
from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_aws as aws

from dns import cname_record
from moved import from_root

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


def _assume_role_policy() -> str:
    return aws.iam.get_policy_document(
        statements=[
            aws.iam.GetPolicyDocumentStatementArgs(
                effect=aws.iam.PolicyStatementEffect.ALLOW,
                actions=["sts:AssumeRole"],
                principals=[
                    aws.iam.GetPolicyDocumentStatementPrincipalArgs(
                        type="Service", identifiers=["ecs-tasks.amazonaws.com"]
                    )
                ],
            )
        ]
    ).json


def _log_group(logical_name: str, name: str) -> aws.cloudwatch.LogGroup:
    return aws.cloudwatch.LogGroup(
        logical_name,
        name=f"/ecs/{name}",
        retention_in_days=LOG_RETENTION_DAYS,
    )


def _execution_role(logical_name: str, name: str) -> aws.iam.Role:
    execution = aws.iam.Role(
        logical_name,
        name=f"{name}-exec",
        assume_role_policy=_assume_role_policy(),
    )

    aws.iam.RolePolicyAttachment(
        logical_name,
        role=execution.name,
        policy_arn=aws.iam.ManagedPolicy.AMAZON_ECS_TASK_EXECUTION_ROLE_POLICY,
    )

    return execution


def _roles(
    env: str,
    name: str,
    bucket: aws.s3.Bucket,
    secret_arns: list[pulumi.Input[str]],
) -> tuple[aws.iam.Role, aws.iam.Role]:
    execution = _execution_role(f"exec-{env}", name)

    aws.iam.RolePolicy(
        f"exec-{env}-secrets",
        role=execution.name,
        policy=aws.iam.get_policy_document_output(
            statements=[
                aws.iam.GetPolicyDocumentStatementArgs(
                    effect=aws.iam.PolicyStatementEffect.ALLOW,
                    actions=["secretsmanager:GetSecretValue"],
                    resources=secret_arns,
                )
            ]
        ).json,
    )

    task = aws.iam.Role(
        f"task-{env}",
        name=f"{name}-task",
        assume_role_policy=_assume_role_policy(),
    )

    aws.iam.RolePolicy(
        f"task-{env}-s3",
        role=task.name,
        policy=aws.iam.get_policy_document_output(
            statements=[
                aws.iam.GetPolicyDocumentStatementArgs(
                    effect=aws.iam.PolicyStatementEffect.ALLOW,
                    actions=S3_OBJECT_ACTIONS,
                    resources=[pulumi.Output.format("{0}/*", bucket.arn)],
                ),
                aws.iam.GetPolicyDocumentStatementArgs(
                    effect=aws.iam.PolicyStatementEffect.ALLOW,
                    actions=["s3:ListBucket"],
                    resources=[bucket.arn],
                ),
            ]
        ).json,
    )

    return execution, task


def _fargate_service(
    logical_name: str,
    *,
    name: str,
    target_group_name: str,
    container_name: str,
    port: int,
    container: pulumi.Output[str],
    execution_role: aws.iam.Role,
    task_role: aws.iam.Role | None = None,
    vpc_id: pulumi.Input[str],
    subnet_ids: pulumi.Input[list],
    task_security_group_id: pulumi.Input[str],
    cluster_arn: pulumi.Input[str],
    listener_arn: pulumi.Input[str],
    hostname: str,
    priority: int,
    path_pattern: str | None = None,
) -> aws.ecs.Service:
    task_definition = aws.ecs.TaskDefinition(
        logical_name,
        family=name,
        cpu=TASK_CPU,
        memory=TASK_MEMORY,
        network_mode="awsvpc",
        requires_compatibilities=["FARGATE"],
        runtime_platform=aws.ecs.TaskDefinitionRuntimePlatformArgs(
            cpu_architecture="ARM64",
            operating_system_family="LINUX",
        ),
        execution_role_arn=execution_role.arn,
        task_role_arn=task_role.arn if task_role else None,
        container_definitions=container,
    )

    target_group = aws.lb.TargetGroup(
        logical_name,
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
        logical_name,
        listener_arn=listener_arn,
        priority=priority,
        conditions=conditions,
        actions=[
            aws.lb.ListenerRuleActionArgs(
                type="forward", target_group_arn=target_group.arn
            )
        ],
    )

    return aws.ecs.Service(
        logical_name,
        name=name,
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
        opts=pulumi.ResourceOptions(ignore_changes=["taskDefinition", "desiredCount"]),
    )


def api_service(
    env: str,
    *,
    name: str,
    image: pulumi.Input[str],
    region: str,
    bucket: aws.s3.Bucket,
    database: aws.rds.Instance,
    secret: aws.secretsmanager.Secret,
    vpc_id: pulumi.Input[str],
    subnet_ids: pulumi.Input[list],
    task_security_group_id: pulumi.Input[str],
    cluster_arn: pulumi.Input[str],
    listener_arn: pulumi.Input[str],
    hostname: str,
    priority: int,
    cors_origin: str,
) -> aws.ecs.Service:
    log_group = _log_group(f"api-{env}", name)

    db_secret_arn = database.master_user_secrets[0].secret_arn
    execution, task = _roles(env, name, bucket, [db_secret_arn, secret.arn])

    container = pulumi.Output.all(
        image=image,
        log_group=log_group.name,
        db_host=database.address,
        db_name=database.db_name,
        db_user=database.username,
        bucket_name=bucket.id,
        db_secret=db_secret_arn,
        app_secret=secret.arn,
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
                        {"name": "BUDDYBIRD_ENV", "value": env},
                        {"name": "DB_HOST", "value": a["db_host"]},
                        {"name": "DB_NAME", "value": a["db_name"]},
                        {"name": "DB_USER", "value": a["db_user"]},
                        {"name": "S3_BUCKET_NAME", "value": a["bucket_name"]},
                        {
                            "name": "S3_BUCKET_DOMAIN",
                            "value": f"https://{a['bucket_name']}.s3.{region}.amazonaws.com",
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
                        {"name": "FRONTEND_CORS_ORIGIN", "value": cors_origin},
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
                            "awslogs-region": region,
                            "awslogs-stream-prefix": "api",
                        },
                    },
                }
            ]
        )
    )

    return _fargate_service(
        f"api-{env}",
        name=name,
        target_group_name=name,
        container_name="api",
        port=API_CONTAINER_PORT,
        container=container,
        execution_role=execution,
        task_role=task,
        vpc_id=vpc_id,
        subnet_ids=subnet_ids,
        task_security_group_id=task_security_group_id,
        cluster_arn=cluster_arn,
        listener_arn=listener_arn,
        hostname=hostname,
        priority=priority,
        path_pattern=API_PATH_PATTERN,
    )


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
        previous_exec_name = "-exec-".join(name.rsplit("-", 1))
        previous_dns_name = args.hostname.split(".")[0]

        logs = log_group(
            name,
            log_group_name=f"/ecs/{args.service_name}",
            opts=from_root(self, name),
        )

        execution = execution_role(
            name,
            role_name=f"{args.service_name}-exec",
            opts=from_root(self, previous_exec_name),
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
            opts=from_root(self, name),
        )

        cname_record(
            f"{name}-dns",
            hostname=args.hostname,
            target=args.dns_target,
            opts=from_root(self, previous_dns_name),
        )

        self.register_outputs({"service": self.service})
