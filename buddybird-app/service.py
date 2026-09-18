import json

import pulumi
import pulumi_aws as aws

API_CONTAINER_PORT = 8000
BACKOFFICE_FRONTEND_PORT = 3000
MBTI_WEB_PORT = 3000
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


def backoffice_frontend_service(
    env: str,
    *,
    name: str,
    target_group_name: str,
    image: pulumi.Input[str],
    region: str,
    vpc_id: pulumi.Input[str],
    subnet_ids: pulumi.Input[list],
    task_security_group_id: pulumi.Input[str],
    cluster_arn: pulumi.Input[str],
    listener_arn: pulumi.Input[str],
    hostname: str,
    priority: int,
) -> aws.ecs.Service:
    log_group = _log_group(f"backoffice-frontend-{env}", name)

    execution = _execution_role(f"backoffice-frontend-exec-{env}", name)

    container = pulumi.Output.all(image=image, log_group=log_group.name).apply(
        lambda a: json.dumps(
            [
                {
                    "name": "backoffice-frontend",
                    "image": a["image"],
                    "essential": True,
                    "portMappings": [
                        {"containerPort": BACKOFFICE_FRONTEND_PORT, "protocol": "tcp"}
                    ],
                    "logConfiguration": {
                        "logDriver": "awslogs",
                        "options": {
                            "awslogs-group": a["log_group"],
                            "awslogs-region": region,
                            "awslogs-stream-prefix": "backoffice-frontend",
                        },
                    },
                }
            ]
        )
    )

    return _fargate_service(
        f"backoffice-frontend-{env}",
        name=name,
        target_group_name=target_group_name,
        container_name="backoffice-frontend",
        port=BACKOFFICE_FRONTEND_PORT,
        container=container,
        execution_role=execution,
        vpc_id=vpc_id,
        subnet_ids=subnet_ids,
        task_security_group_id=task_security_group_id,
        cluster_arn=cluster_arn,
        listener_arn=listener_arn,
        hostname=hostname,
        priority=priority,
    )


def mbti_web_service(
    env: str,
    *,
    name: str,
    image: pulumi.Input[str],
    region: str,
    vpc_id: pulumi.Input[str],
    subnet_ids: pulumi.Input[list],
    task_security_group_id: pulumi.Input[str],
    cluster_arn: pulumi.Input[str],
    listener_arn: pulumi.Input[str],
    hostname: str,
    priority: int,
) -> aws.ecs.Service:
    log_group = _log_group(f"mbti-web-{env}", name)

    execution = _execution_role(f"mbti-web-exec-{env}", name)

    container = pulumi.Output.all(image=image, log_group=log_group.name).apply(
        lambda a: json.dumps(
            [
                {
                    "name": "mbti-web",
                    "image": a["image"],
                    "essential": True,
                    "portMappings": [
                        {"containerPort": MBTI_WEB_PORT, "protocol": "tcp"}
                    ],
                    "logConfiguration": {
                        "logDriver": "awslogs",
                        "options": {
                            "awslogs-group": a["log_group"],
                            "awslogs-region": region,
                            "awslogs-stream-prefix": "mbti-web",
                        },
                    },
                }
            ]
        )
    )

    return _fargate_service(
        f"mbti-web-{env}",
        name=name,
        target_group_name=name,
        container_name="mbti-web",
        port=MBTI_WEB_PORT,
        container=container,
        execution_role=execution,
        vpc_id=vpc_id,
        subnet_ids=subnet_ids,
        task_security_group_id=task_security_group_id,
        cluster_arn=cluster_arn,
        listener_arn=listener_arn,
        hostname=hostname,
        priority=priority,
    )
