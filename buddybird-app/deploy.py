import json

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
)

OIDC_HOST = "token.actions.githubusercontent.com"
OIDC_AUDIENCE = "sts.amazonaws.com"

SUB_PREFIX = "repo:ASM-joynnovate@279207361/buddybird-api@1262535317"
DEPLOY_SUBS = [
    f"{SUB_PREFIX}:ref:refs/heads/main",
    f"{SUB_PREFIX}:environment:prod",
]

SITE_SUB_PREFIX = "repo:ASM-joynnovate@279207361/buddybird-landing@1275213976"
SITE_DEPLOY_SUBS = [f"{SITE_SUB_PREFIX}:ref:refs/heads/main"]

SITE_SYNC_ACTIONS = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]

ECR_PUSH_ACTIONS = [
    "ecr:BatchCheckLayerAvailability",
    "ecr:BatchGetImage",
    "ecr:CompleteLayerUpload",
    "ecr:GetDownloadUrlForLayer",
    "ecr:InitiateLayerUpload",
    "ecr:PutImage",
    "ecr:UploadLayerPart",
]

ECR_UNTAGGED_EXPIRE_DAYS = 7
ECR_IMAGE_LIMIT = 20


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
                effect="Allow",
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


def _deploy_policy(
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
                effect="Allow",
                actions=["ecr:GetAuthorizationToken"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="EcrPush",
                effect="Allow",
                actions=ECR_PUSH_ACTIONS,
                resources=[repository_arn],
            ),
            GetPolicyDocumentStatementArgs(
                sid="RegisterTaskDefinition",
                effect="Allow",
                actions=["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="UpdateService",
                effect="Allow",
                actions=["ecs:UpdateService", "ecs:DescribeServices"],
                resources=[
                    f"arn:aws:ecs:{region}:{account_id}:service/{cluster_name}/{prefix}-*"
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="RunMigrationTask",
                effect="Allow",
                actions=["ecs:RunTask"],
                resources=[
                    f"arn:aws:ecs:{region}:{account_id}:task-definition/{prefix}-*:*"
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DescribeTasks",
                effect="Allow",
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
                effect="Allow",
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
                effect="Allow",
                actions=["logs:GetLogEvents", "logs:DescribeLogStreams"],
                resources=[
                    f"arn:aws:logs:{region}:{account_id}:log-group:/ecs/{prefix}-*:*"
                ],
            ),
        ]
    ).json


def deploy_role(
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
        "deploy",
        name=name,
        description="buddybird-api GitHub Actions image push and ECS service update",
        assume_role_policy=_trust_policy(account_id, DEPLOY_SUBS),
    )

    aws.iam.RolePolicy(
        "deploy",
        role=role.name,
        policy=_deploy_policy(
            account_id, region, repository_arn, cluster_arn, cluster_name, prefix
        ),
    )

    return role


def site_deploy_role(
    *,
    name: str,
    account_id: str,
    bucket_arn: pulumi.Input[str],
    distribution_arn: pulumi.Input[str],
) -> aws.iam.Role:
    role = aws.iam.Role(
        "site-deploy",
        name=name,
        description="buddybird-landing GitHub Actions S3 sync and CloudFront invalidation",
        assume_role_policy=_trust_policy(account_id, SITE_DEPLOY_SUBS),
    )

    aws.iam.RolePolicy(
        "site-deploy",
        role=role.name,
        policy=aws.iam.get_policy_document_output(
            statements=[
                GetPolicyDocumentStatementArgs(
                    sid="ListSiteBucket",
                    effect="Allow",
                    actions=["s3:ListBucket"],
                    resources=[bucket_arn],
                ),
                GetPolicyDocumentStatementArgs(
                    sid="SyncSiteObjects",
                    effect="Allow",
                    actions=SITE_SYNC_ACTIONS,
                    resources=[pulumi.Output.format("{0}/*", bucket_arn)],
                ),
                GetPolicyDocumentStatementArgs(
                    sid="InvalidateCache",
                    effect="Allow",
                    actions=["cloudfront:CreateInvalidation"],
                    resources=[distribution_arn],
                ),
            ]
        ).json,
    )

    return role
