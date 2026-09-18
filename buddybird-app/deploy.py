import json
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

PREVIOUS_DEPLOY_NAMES = {"backoffice-frontend": "bo-fe-deploy"}


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
        previous_deploy_name = PREVIOUS_DEPLOY_NAMES.get(name, f"{name}-deploy")

        self.repository = aws.ecr.Repository(
            f"{name}-repository",
            name=args.repository_name,
            image_tag_mutability="IMMUTABLE",
            image_scanning_configuration=aws.ecr.RepositoryImageScanningConfigurationArgs(
                scan_on_push=True
            ),
            opts=from_root(self, name),
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
            opts=from_root(self, name),
        )

        self.deploy_role = aws.iam.Role(
            f"{name}-deploy-role",
            name=args.role_name,
            description=f"buddybird-{name} GitHub Actions image push and ECS service update",
            assume_role_policy=trust_policy(args.account_id, list(args.subs)),
            opts=pulumi.ResourceOptions.merge(
                from_root(self, previous_deploy_name),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        aws.iam.RolePolicy(
            f"{name}-deploy-policy",
            role=self.deploy_role.name,
            policy=_deploy_policy(args, self.repository.arn),
            opts=from_root(self, previous_deploy_name),
        )

        self.register_outputs(
            {"repository": self.repository, "deploy_role": self.deploy_role}
        )


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
