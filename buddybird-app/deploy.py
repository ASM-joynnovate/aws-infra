import json

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

OIDC_HOST = "token.actions.githubusercontent.com"
OIDC_AUDIENCE = "sts.amazonaws.com"

API_SUB_PREFIX = "repo:ASM-joynnovate@279207361/buddybird-api@1262535317"
API_DEPLOY_SUBS = [
    f"{API_SUB_PREFIX}:ref:refs/heads/main",
    f"{API_SUB_PREFIX}:ref:refs/heads/dev",
    f"{API_SUB_PREFIX}:environment:prod",
]

LANDING_FE_SUB_PREFIX = "repo:ASM-joynnovate@279207361/buddybird-landing@1275213976"
LANDING_FE_DEPLOY_SUBS = [f"{LANDING_FE_SUB_PREFIX}:ref:refs/heads/main"]

BO_FE_SUB_PREFIX = (
    "repo:ASM-joynnovate@279207361/buddybird-backoffice-frontend@1342074306"
)
BO_FE_DEPLOY_SUBS = [
    f"{BO_FE_SUB_PREFIX}:ref:refs/heads/main",
    f"{BO_FE_SUB_PREFIX}:ref:refs/heads/dev",
]

MBTI_WEB_SUB_PREFIX = "repo:ASM-joynnovate@279207361/buddybird-mbti-web@1257251018"
MBTI_WEB_DEPLOY_SUBS = [
    f"{MBTI_WEB_SUB_PREFIX}:ref:refs/heads/main",
]

LANDING_FE_SYNC_ACTIONS = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]

ECR_PUSH_ACTIONS = [
    "ecr:BatchCheckLayerAvailability",
    "ecr:BatchGetImage",
    "ecr:CompleteLayerUpload",
    "ecr:DescribeImages",
    "ecr:GetDownloadUrlForLayer",
    "ecr:InitiateLayerUpload",
    "ecr:PutImage",
    "ecr:UploadLayerPart",
]

ECR_UNTAGGED_EXPIRE_DAYS = 7
ECR_IMAGE_LIMIT = 20

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


def ecr_repository(name: str, logical_name: str) -> aws.ecr.Repository:
    repository = aws.ecr.Repository(
        logical_name,
        name=name,
        image_tag_mutability="IMMUTABLE",
        image_scanning_configuration=aws.ecr.RepositoryImageScanningConfigurationArgs(
            scan_on_push=True
        ),
    )

    aws.ecr.LifecyclePolicy(
        logical_name,
        repository=repository.name,
        policy=json.dumps(
            {
                "rules": [
                    {
                        "rulePriority": 1,
                        "description": "Expire untagged images",
                        "selection": {
                            "tagStatus": aws.ecr.LifecyclePolicyTagStatus.UNTAGGED,
                            "countType": aws.ecr.LifecyclePolicyCountType.SINCE_IMAGE_PUSHED,
                            "countUnit": "days",
                            "countNumber": ECR_UNTAGGED_EXPIRE_DAYS,
                        },
                        "action": {"type": aws.ecr.LifecyclePolicyActionType.EXPIRE},
                    },
                    {
                        "rulePriority": 2,
                        "description": "Keep recent images only",
                        "selection": {
                            "tagStatus": aws.ecr.LifecyclePolicyTagStatus.ANY,
                            "countType": aws.ecr.LifecyclePolicyCountType.IMAGE_COUNT_MORE_THAN,
                            "countNumber": ECR_IMAGE_LIMIT,
                        },
                        "action": {"type": aws.ecr.LifecyclePolicyActionType.EXPIRE},
                    },
                ]
            }
        ),
    )

    return repository


def _trust_policy(account_id: str, subs: list[str]) -> pulumi.Output[str]:
    provider_arn = f"arn:aws:iam::{account_id}:oidc-provider/{OIDC_HOST}"
    return aws.iam.get_policy_document_output(
        statements=[
            GetPolicyDocumentStatementArgs(
                effect=PolicyStatementEffect.ALLOW,
                actions=["sts:AssumeRoleWithWebIdentity"],
                principals=[
                    GetPolicyDocumentStatementPrincipalArgs(
                        type="Federated",
                        identifiers=[provider_arn],
                    )
                ],
                conditions=[
                    GetPolicyDocumentStatementConditionArgs(
                        test="StringEquals",
                        variable=f"{OIDC_HOST}:aud",
                        values=[OIDC_AUDIENCE],
                    ),
                    GetPolicyDocumentStatementConditionArgs(
                        test="StringEquals",
                        variable=f"{OIDC_HOST}:sub",
                        values=subs,
                    ),
                ],
            )
        ]
    ).json


def _api_deploy_policy(
    account_id: str,
    region: str,
    repository_arn: pulumi.Input[str],
    cluster_arn: pulumi.Input[str],
    cluster_name: str,
    prefix: str,
) -> pulumi.Output[str]:
    return aws.iam.get_policy_document_output(
        statements=[
            GetPolicyDocumentStatementArgs(
                sid="EcrLogin",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecr:GetAuthorizationToken"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="EcrPush",
                effect=PolicyStatementEffect.ALLOW,
                actions=ECR_PUSH_ACTIONS,
                resources=[repository_arn],
            ),
            GetPolicyDocumentStatementArgs(
                sid="RegisterTaskDefinition",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="UpdateService",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecs:UpdateService", "ecs:DescribeServices"],
                resources=[
                    f"arn:aws:ecs:{region}:{account_id}:service/{cluster_name}/{prefix}-*"
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="RunMigrationTask",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecs:RunTask"],
                resources=[
                    f"arn:aws:ecs:{region}:{account_id}:task-definition/{prefix}-*:*"
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DescribeTasks",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecs:DescribeTasks"],
                resources=[f"arn:aws:ecs:{region}:{account_id}:task/{cluster_name}/*"],
                conditions=[
                    GetPolicyDocumentStatementConditionArgs(
                        test="ArnEquals",
                        variable="ecs:cluster",
                        values=[cluster_arn],
                    )
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="PassTaskRoles",
                effect=PolicyStatementEffect.ALLOW,
                actions=["iam:PassRole"],
                resources=[
                    f"arn:aws:iam::{account_id}:role/{prefix}-*-task",
                    f"arn:aws:iam::{account_id}:role/{prefix}-*-exec",
                ],
                conditions=[
                    GetPolicyDocumentStatementConditionArgs(
                        test="StringEquals",
                        variable="iam:PassedToService",
                        values=["ecs-tasks.amazonaws.com"],
                    )
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="ReadMigrationLogs",
                effect=PolicyStatementEffect.ALLOW,
                actions=["logs:GetLogEvents", "logs:DescribeLogStreams"],
                resources=[
                    f"arn:aws:logs:{region}:{account_id}:log-group:/ecs/{prefix}-*:*"
                ],
            ),
        ]
    ).json


def api_deploy_role(
    *,
    name: str,
    account_id: str,
    region: str,
    repository_arn: pulumi.Input[str],
    cluster_arn: pulumi.Input[str],
    cluster_name: str,
    prefix: str,
) -> aws.iam.Role:
    role = aws.iam.Role(
        "api-deploy",
        name=name,
        description="buddybird-api GitHub Actions image push and ECS service update",
        assume_role_policy=_trust_policy(account_id, API_DEPLOY_SUBS),
    )

    aws.iam.RolePolicy(
        "api-deploy",
        role=role.name,
        policy=_api_deploy_policy(
            account_id, region, repository_arn, cluster_arn, cluster_name, prefix
        ),
    )

    return role


def _bo_fe_deploy_policy(
    account_id: str,
    region: str,
    repository_arn: pulumi.Input[str],
    cluster_name: str,
    prefix: str,
) -> pulumi.Output[str]:
    return aws.iam.get_policy_document_output(
        statements=[
            GetPolicyDocumentStatementArgs(
                sid="EcrLogin",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecr:GetAuthorizationToken"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="EcrPush",
                effect=PolicyStatementEffect.ALLOW,
                actions=ECR_PUSH_ACTIONS,
                resources=[repository_arn],
            ),
            GetPolicyDocumentStatementArgs(
                sid="RegisterTaskDefinition",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="UpdateService",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecs:UpdateService", "ecs:DescribeServices"],
                resources=[
                    f"arn:aws:ecs:{region}:{account_id}:service/{cluster_name}/{prefix}-*"
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="PassExecRole",
                effect=PolicyStatementEffect.ALLOW,
                actions=["iam:PassRole"],
                resources=[
                    f"arn:aws:iam::{account_id}:role/{prefix}-*-exec",
                ],
                conditions=[
                    GetPolicyDocumentStatementConditionArgs(
                        test="StringEquals",
                        variable="iam:PassedToService",
                        values=["ecs-tasks.amazonaws.com"],
                    )
                ],
            ),
        ]
    ).json


def backoffice_frontend_deploy_role(
    *,
    name: str,
    account_id: str,
    region: str,
    repository_arn: pulumi.Input[str],
    cluster_name: str,
    prefix: str,
) -> aws.iam.Role:
    role = aws.iam.Role(
        "bo-fe-deploy",
        name=name,
        description="buddybird-backoffice-frontend GitHub Actions image push and ECS service update",
        assume_role_policy=_trust_policy(account_id, BO_FE_DEPLOY_SUBS),
    )

    aws.iam.RolePolicy(
        "bo-fe-deploy",
        role=role.name,
        policy=_bo_fe_deploy_policy(
            account_id, region, repository_arn, cluster_name, prefix
        ),
    )

    return role


def _mbti_web_deploy_policy(
    account_id: str,
    region: str,
    repository_arn: pulumi.Input[str],
    cluster_name: str,
    prefix: str,
) -> pulumi.Output[str]:
    return aws.iam.get_policy_document_output(
        statements=[
            GetPolicyDocumentStatementArgs(
                sid="EcrLogin",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecr:GetAuthorizationToken"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="EcrPush",
                effect=PolicyStatementEffect.ALLOW,
                actions=ECR_PUSH_ACTIONS,
                resources=[repository_arn],
            ),
            GetPolicyDocumentStatementArgs(
                sid="RegisterTaskDefinition",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="UpdateService",
                effect=PolicyStatementEffect.ALLOW,
                actions=["ecs:UpdateService", "ecs:DescribeServices"],
                resources=[
                    f"arn:aws:ecs:{region}:{account_id}:service/{cluster_name}/{prefix}-*"
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="PassExecRole",
                effect=PolicyStatementEffect.ALLOW,
                actions=["iam:PassRole"],
                resources=[
                    f"arn:aws:iam::{account_id}:role/{prefix}-*-exec",
                ],
                conditions=[
                    GetPolicyDocumentStatementConditionArgs(
                        test="StringEquals",
                        variable="iam:PassedToService",
                        values=["ecs-tasks.amazonaws.com"],
                    )
                ],
            ),
        ]
    ).json


def mbti_web_deploy_role(
    *,
    name: str,
    account_id: str,
    region: str,
    repository_arn: pulumi.Input[str],
    cluster_name: str,
    prefix: str,
) -> aws.iam.Role:
    role = aws.iam.Role(
        "mbti-web-deploy",
        name=name,
        description="buddybird-mbti-web GitHub Actions image push and ECS service update",
        assume_role_policy=_trust_policy(account_id, MBTI_WEB_DEPLOY_SUBS),
    )

    aws.iam.RolePolicy(
        "mbti-web-deploy",
        role=role.name,
        policy=_mbti_web_deploy_policy(
            account_id, region, repository_arn, cluster_name, prefix
        ),
    )

    return role


def rotation_redeploy(
    env: str,
    *,
    name: str,
    secret_arn: pulumi.Input[str],
    cluster_arn: pulumi.Input[str],
    service: aws.ecs.Service,
) -> None:
    role = aws.iam.Role(
        f"rotation-{env}",
        name=f"{name}-rotation",
        description=f"buddybird-api {env} redeploy on RDS password rotation",
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
    )

    aws.iam.RolePolicyAttachment(
        f"rotation-{env}",
        role=role.name,
        policy_arn=aws.iam.ManagedPolicy.AWS_LAMBDA_BASIC_EXECUTION_ROLE,
    )

    aws.iam.RolePolicy(
        f"rotation-{env}",
        role=role.name,
        policy=aws.iam.get_policy_document_output(
            statements=[
                GetPolicyDocumentStatementArgs(
                    effect=PolicyStatementEffect.ALLOW,
                    actions=["ecs:UpdateService"],
                    resources=[service.id],
                )
            ]
        ).json,
    )

    function = aws.lambda_.Function(
        f"rotation-{env}",
        name=f"{name}-rotation",
        role=role.arn,
        runtime=aws.lambda_.Runtime.PYTHON3D14,
        handler="index.handler",
        timeout=ROTATION_REDEPLOY_TIMEOUT_SECONDS,
        code=pulumi.AssetArchive(
            {"index.py": pulumi.StringAsset(ROTATION_REDEPLOY_CODE)}
        ),
        environment=aws.lambda_.FunctionEnvironmentArgs(
            variables={"CLUSTER": cluster_arn, "SERVICE": service.name}
        ),
    )

    rule = aws.cloudwatch.EventRule(
        f"rotation-{env}",
        name=f"{name}-rotation",
        event_pattern=pulumi.Output.json_dumps(
            {
                "source": ["aws.secretsmanager"],
                "detail-type": ["Secret Label Updated"],
                "resources": [secret_arn],
                "detail": {"labelUpdated": ["AWSCURRENT"]},
            }
        ),
    )

    aws.lambda_.Permission(
        f"rotation-{env}",
        action="lambda:InvokeFunction",
        function=function.name,
        principal="events.amazonaws.com",
        source_arn=rule.arn,
    )

    aws.cloudwatch.EventTarget(
        f"rotation-{env}",
        rule=rule.name,
        arn=function.arn,
    )


def landing_fe_deploy_role(
    *,
    name: str,
    account_id: str,
    bucket_arn: pulumi.Input[str],
    distribution_arn: pulumi.Input[str],
) -> aws.iam.Role:
    role = aws.iam.Role(
        "landing-fe-deploy",
        name=name,
        description="buddybird-landing GitHub Actions S3 sync and CloudFront invalidation",
        assume_role_policy=_trust_policy(account_id, LANDING_FE_DEPLOY_SUBS),
    )

    aws.iam.RolePolicy(
        "landing-fe-deploy",
        role=role.name,
        policy=aws.iam.get_policy_document_output(
            statements=[
                GetPolicyDocumentStatementArgs(
                    sid="ListSiteBucket",
                    effect=PolicyStatementEffect.ALLOW,
                    actions=["s3:ListBucket"],
                    resources=[bucket_arn],
                ),
                GetPolicyDocumentStatementArgs(
                    sid="SyncSiteObjects",
                    effect=PolicyStatementEffect.ALLOW,
                    actions=LANDING_FE_SYNC_ACTIONS,
                    resources=[pulumi.Output.format("{0}/*", bucket_arn)],
                ),
                GetPolicyDocumentStatementArgs(
                    sid="InvalidateCache",
                    effect=PolicyStatementEffect.ALLOW,
                    actions=["cloudfront:CreateInvalidation"],
                    resources=[distribution_arn],
                ),
            ]
        ).json,
    )

    return role
