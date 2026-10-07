import json
from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    PolicyStatementEffect,
)

from oidc import trust_policy

API_SUB_PREFIX = "repo:ASM-joynnovate@279207361/buddybird-api@1262535317"
API_DEPLOY_SUBS = [
    f"{API_SUB_PREFIX}:ref:refs/heads/main",
    f"{API_SUB_PREFIX}:ref:refs/heads/dev",
    f"{API_SUB_PREFIX}:environment:prod",
]

BACKOFFICE_FRONTEND_SUB_PREFIX = (
    "repo:ASM-joynnovate@279207361/buddybird-backoffice-frontend@1342074306"
)
BACKOFFICE_FRONTEND_DEPLOY_SUBS = [
    f"{BACKOFFICE_FRONTEND_SUB_PREFIX}:ref:refs/heads/main",
    f"{BACKOFFICE_FRONTEND_SUB_PREFIX}:ref:refs/heads/dev",
]

MBTI_WEB_SUB_PREFIX = "repo:ASM-joynnovate@279207361/buddybird-mbti-web@1257251018"
MBTI_WEB_DEPLOY_SUBS = [
    f"{MBTI_WEB_SUB_PREFIX}:ref:refs/heads/main",
    f"{MBTI_WEB_SUB_PREFIX}:environment:prod",
]

AUDIO_AI_SUB_PREFIX = "repo:ASM-joynnovate@279207361/buddybird-ai-api@1367456561"
AUDIO_AI_DEPLOY_SUBS = [
    f"{AUDIO_AI_SUB_PREFIX}:ref:refs/heads/main",
    f"{AUDIO_AI_SUB_PREFIX}:ref:refs/heads/dev",
]

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


@dataclass(frozen=True)
class ImageDeliveryArgs:
    repository_name: str
    role_name: str
    subs: Sequence[str]
    account_id: str
    region: str
    cluster_name: str
    prefix: str
    migration_cluster_arn: pulumi.Input[str] | None = None
    lambda_function: bool = False


def _deploy_policy(
    args: ImageDeliveryArgs, repository_arn: pulumi.Input[str]
) -> pulumi.Output[str]:
    account_id = args.account_id
    region = args.region
    prefix = args.prefix
    cluster_name = args.cluster_name

    statements = [
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
    ]

    if args.lambda_function:
        statements.append(
            GetPolicyDocumentStatementArgs(
                sid="UpdateFunctionCode",
                effect=PolicyStatementEffect.ALLOW,
                actions=[
                    "lambda:UpdateFunctionCode",
                    "lambda:GetFunction",
                ],
                resources=[f"arn:aws:lambda:{region}:{account_id}:function:{prefix}-*"],
            )
        )

        return aws.iam.get_policy_document_output(statements=statements).json

    statements += [
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
    ]

    passed_to_ecs_tasks = GetPolicyDocumentStatementConditionArgs(
        test="StringEquals",
        variable="iam:PassedToService",
        values=["ecs-tasks.amazonaws.com"],
    )

    if args.migration_cluster_arn is None:
        statements.append(
            GetPolicyDocumentStatementArgs(
                sid="PassExecRole",
                effect=PolicyStatementEffect.ALLOW,
                actions=["iam:PassRole"],
                resources=[f"arn:aws:iam::{account_id}:role/{prefix}-*-exec"],
                conditions=[passed_to_ecs_tasks],
            )
        )
    else:
        statements.extend(
            [
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
                    resources=[
                        f"arn:aws:ecs:{region}:{account_id}:task/{cluster_name}/*"
                    ],
                    conditions=[
                        GetPolicyDocumentStatementConditionArgs(
                            test="ArnEquals",
                            variable="ecs:cluster",
                            values=[args.migration_cluster_arn],
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
                    conditions=[passed_to_ecs_tasks],
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
        )

    return aws.iam.get_policy_document_output(statements=statements).json


class ImageDelivery(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: ImageDeliveryArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:ImageDelivery", name, None, opts)
        child = pulumi.ResourceOptions(parent=self)

        self.repository = aws.ecr.Repository(
            f"{name}-repository",
            name=args.repository_name,
            image_tag_mutability="IMMUTABLE",
            image_scanning_configuration=aws.ecr.RepositoryImageScanningConfigurationArgs(
                scan_on_push=True
            ),
            opts=child,
        )

        aws.ecr.LifecyclePolicy(
            f"{name}-lifecycle",
            repository=self.repository.name,
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
                            "action": {
                                "type": aws.ecr.LifecyclePolicyActionType.EXPIRE
                            },
                        },
                        {
                            "rulePriority": 2,
                            "description": "Keep recent images only",
                            "selection": {
                                "tagStatus": aws.ecr.LifecyclePolicyTagStatus.ANY,
                                "countType": aws.ecr.LifecyclePolicyCountType.IMAGE_COUNT_MORE_THAN,
                                "countNumber": ECR_IMAGE_LIMIT,
                            },
                            "action": {
                                "type": aws.ecr.LifecyclePolicyActionType.EXPIRE
                            },
                        },
                    ]
                }
            ),
            opts=child,
        )

        self.deploy_role = aws.iam.Role(
            f"{name}-deploy-role",
            name=args.role_name,
            description=(
                f"buddybird-{name} GitHub Actions image push and Lambda function update"
                if args.lambda_function
                else f"buddybird-{name} GitHub Actions image push and ECS service update"
            ),
            assume_role_policy=trust_policy(args.account_id, list(args.subs)),
            opts=pulumi.ResourceOptions.merge(
                child,
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        aws.iam.RolePolicy(
            f"{name}-deploy-policy",
            role=self.deploy_role.name,
            policy=_deploy_policy(args, self.repository.arn),
            opts=child,
        )

        self.register_outputs(
            {"repository": self.repository, "deploy_role": self.deploy_role}
        )
