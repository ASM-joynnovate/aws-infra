import pulumi
import pulumi_aws as aws

PORT = 8000
CPU = "256"
MEMORY = "512"
HEALTH_PATH = "/api/healthz"
PATH_PATTERN = "/api/*"
LOG_RETENTION_DAYS = 30
DEREGISTRATION_DELAY = 30
HEALTH_GRACE_SECONDS = 60

AUTH_ALGORITHM = "HS256"
AUTH_ACCESS_TOKEN_EXPIRE_MINUTES = 10080
AUTH_REFRESH_TOKEN_EXPIRE_MINUTES = 20160

EXECUTION_POLICY_ARN = (
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
)
ECS_TASK_PRINCIPAL = "ecs-tasks.amazonaws.com"

S3_OBJECT_ACTIONS = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]


def _assume_role_policy() -> str:
    return aws.iam.get_policy_document(
        statements=[
            aws.iam.GetPolicyDocumentStatementArgs(
                effect="Allow",
                actions=["sts:AssumeRole"],
                principals=[
                    aws.iam.GetPolicyDocumentStatementPrincipalArgs(
                        type="Service", identifiers=[ECS_TASK_PRINCIPAL]
                    )
                ],
            )
        ]
    ).json


def _roles(env, name, bucket, secret_arns):
    execution = aws.iam.Role(
        f"exec-{env}",
        name=f"{name}-exec",
        assume_role_policy=_assume_role_policy(),
    )

    aws.iam.RolePolicyAttachment(
        f"exec-{env}",
        role=execution.name,
        policy_arn=EXECUTION_POLICY_ARN,
    )

    aws.iam.RolePolicy(
        f"exec-{env}-secrets",
        role=execution.name,
        policy=aws.iam.get_policy_document_output(
            statements=[
                aws.iam.GetPolicyDocumentStatementArgs(
                    effect="Allow",
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
                    effect="Allow",
                    actions=S3_OBJECT_ACTIONS,
                    resources=[pulumi.Output.format("{0}/*", bucket.arn)],
                ),
                aws.iam.GetPolicyDocumentStatementArgs(
                    effect="Allow",
                    actions=["s3:ListBucket"],
                    resources=[bucket.arn],
                ),
            ]
        ).json,
    )

    return execution, task


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
) -> aws.ecs.Service:
    log_group = aws.cloudwatch.LogGroup(
        f"api-{env}",
        name=f"/ecs/{name}",
        retention_in_days=LOG_RETENTION_DAYS,
    )

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
        lambda a: [
            {
                "name": "api",
                "image": a["image"],
                "essential": True,
                "portMappings": [{"containerPort": PORT, "protocol": "tcp"}],
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

    task_definition = aws.ecs.TaskDefinition(
        f"api-{env}",
        family=name,
        cpu=CPU,
        memory=MEMORY,
        network_mode="awsvpc",
        requires_compatibilities=["FARGATE"],
        runtime_platform=aws.ecs.TaskDefinitionRuntimePlatformArgs(
            cpu_architecture="ARM64",
            operating_system_family="LINUX",
        ),
        execution_role_arn=execution.arn,
        task_role_arn=task.arn,
        container_definitions=container.apply(pulumi.Output.json_dumps),
    )

    target_group = aws.lb.TargetGroup(
        f"api-{env}",
        name=name,
        port=PORT,
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

    aws.lb.ListenerRule(
        f"api-{env}",
        listener_arn=listener_arn,
        priority=priority,
        conditions=[
            aws.lb.ListenerRuleConditionArgs(
                host_header=aws.lb.ListenerRuleConditionHostHeaderArgs(
                    values=[hostname]
                )
            ),
            aws.lb.ListenerRuleConditionArgs(
                path_pattern=aws.lb.ListenerRuleConditionPathPatternArgs(
                    values=[PATH_PATTERN]
                )
            ),
        ],
        actions=[
            aws.lb.ListenerRuleActionArgs(
                type="forward", target_group_arn=target_group.arn
            )
        ],
    )

    return aws.ecs.Service(
        f"api-{env}",
        name=name,
        cluster=cluster_arn,
        task_definition=task_definition.arn,
        desired_count=1,
        launch_type="FARGATE",
        health_check_grace_period_seconds=HEALTH_GRACE_SECONDS,
        network_configuration=aws.ecs.ServiceNetworkConfigurationArgs(
            subnets=subnet_ids,
            security_groups=[task_security_group_id],
            assign_public_ip=True,
        ),
        load_balancers=[
            aws.ecs.ServiceLoadBalancerArgs(
                target_group_arn=target_group.arn,
                container_name="api",
                container_port=PORT,
            )
        ],
        opts=pulumi.ResourceOptions(
            ignore_changes=["taskDefinition", "desiredCount"]
        ),
    )
