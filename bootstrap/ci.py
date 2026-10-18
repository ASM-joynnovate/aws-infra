from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

OIDC_HOST = "token.actions.githubusercontent.com"
OIDC_URL = f"https://{OIDC_HOST}"
OIDC_AUDIENCE = "sts.amazonaws.com"

SUB_PREFIX = "repo:ASM-joynnovate@279207361/aws-infra@1311763701"
PREVIEW_SUB = f"{SUB_PREFIX}:pull_request"
PULUMI_SUB = f"{SUB_PREFIX}:environment:prod"

CI_ROLE_PREFIX = "jn-ci"
PREVIEW_ROLE_NAME = f"{CI_ROLE_PREFIX}-preview"
PULUMI_ROLE_NAME = f"{CI_ROLE_PREFIX}-pulumi"

ROLE_WRITE_ACTIONS = [
    "iam:CreateRole",
    "iam:DeleteRole",
    "iam:UpdateRole",
    "iam:UpdateAssumeRolePolicy",
    "iam:TagRole",
    "iam:UntagRole",
    "iam:AttachRolePolicy",
    "iam:DetachRolePolicy",
    "iam:PutRolePolicy",
    "iam:DeleteRolePolicy",
]

POLICY_WRITE_ACTIONS = [
    "iam:CreatePolicy",
    "iam:DeletePolicy",
    "iam:CreatePolicyVersion",
    "iam:DeletePolicyVersion",
    "iam:TagPolicy",
    "iam:UntagPolicy",
]


def _trust_policy(provider_arn, sub):
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
                        values=[sub],
                    ),
                ],
            )
        ]
    ).json


def _preview_policy(state_bucket_arn, secrets_key_arn):
    return aws.iam.get_policy_document_output(
        statements=[
            GetPolicyDocumentStatementArgs(
                sid="StateLock",
                effect=PolicyStatementEffect.ALLOW,
                actions=["s3:PutObject", "s3:DeleteObject"],
                resources=[
                    pulumi.Output.format("{0}/.pulumi/locks/*", state_bucket_arn)
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DecryptStackSecrets",
                effect=PolicyStatementEffect.ALLOW,
                actions=["kms:Decrypt"],
                resources=[secrets_key_arn],
            ),
            GetPolicyDocumentStatementArgs(
                sid="ReadSecretValues",
                effect=PolicyStatementEffect.ALLOW,
                actions=["secretsmanager:GetSecretValue"],
                resources=["*"],
            ),
        ]
    ).json


def _pulumi_policy(account_id, state_bucket_arn, secrets_key_arn):
    return aws.iam.get_policy_document_output(
        statements=[
            GetPolicyDocumentStatementArgs(
                sid="ManageServiceRoles",
                effect=PolicyStatementEffect.ALLOW,
                actions=ROLE_WRITE_ACTIONS
                + POLICY_WRITE_ACTIONS
                + [
                    "iam:PassRole",
                    "iam:GetRole",
                    "iam:GetRolePolicy",
                    "iam:ListAttachedRolePolicies",
                    "iam:ListRolePolicies",
                    "iam:GetInstanceProfile",
                    "iam:ListInstanceProfilesForRole",
                ],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenyPersistentCredentials",
                effect=PolicyStatementEffect.DENY,
                actions=[
                    "iam:CreateUser",
                    "iam:CreateAccessKey",
                    "iam:CreateLoginProfile",
                    "iam:CreateServiceSpecificCredential",
                ],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenyOidcProviderChanges",
                effect=PolicyStatementEffect.DENY,
                actions=[
                    "iam:CreateOpenIDConnectProvider",
                    "iam:DeleteOpenIDConnectProvider",
                    "iam:UpdateOpenIDConnectProviderThumbprint",
                    "iam:AddClientIDToOpenIDConnectProvider",
                    "iam:RemoveClientIDFromOpenIDConnectProvider",
                    "iam:TagOpenIDConnectProvider",
                    "iam:UntagOpenIDConnectProvider",
                ],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenyCiRoleChanges",
                effect=PolicyStatementEffect.DENY,
                actions=ROLE_WRITE_ACTIONS,
                resources=[f"arn:aws:iam::{account_id}:role/{CI_ROLE_PREFIX}-*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenyStateBucketDeletion",
                effect=PolicyStatementEffect.DENY,
                actions=["s3:DeleteBucket"],
                resources=[state_bucket_arn],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenySecretsKeyDestruction",
                effect=PolicyStatementEffect.DENY,
                actions=[
                    "kms:ScheduleKeyDeletion",
                    "kms:DisableKey",
                    "kms:DisableKeyRotation",
                    "kms:PutKeyPolicy",
                ],
                resources=[secrets_key_arn],
            ),
        ]
    ).json


@dataclass(frozen=True)
class CiRolesArgs:
    account_id: str
    state_bucket_arn: pulumi.Input[str]
    secrets_key_arn: pulumi.Input[str]


class CiRoles(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: CiRolesArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:bootstrap:CiRoles", name, None, opts)

        provider = aws.iam.OpenIdConnectProvider(
            f"{name}-github-oidc-provider",
            url=OIDC_URL,
            client_id_lists=[OIDC_AUDIENCE],
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.preview_role = aws.iam.Role(
            f"{name}-preview-role",
            name=PREVIEW_ROLE_NAME,
            description="Read-only role for pulumi preview on pull requests",
            assume_role_policy=_trust_policy(provider.arn, PREVIEW_SUB),
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        aws.iam.RolePolicyAttachment(
            f"{name}-preview-role-read-only",
            role=self.preview_role.name,
            policy_arn=aws.iam.ManagedPolicy.READ_ONLY_ACCESS,
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.iam.RolePolicy(
            f"{name}-preview-role-state",
            role=self.preview_role.name,
            policy=_preview_policy(args.state_bucket_arn, args.secrets_key_arn),
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.pulumi_role = aws.iam.Role(
            f"{name}-pulumi-role",
            name=PULUMI_ROLE_NAME,
            description="Role for pulumi up after prod environment approval",
            assume_role_policy=_trust_policy(provider.arn, PULUMI_SUB),
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        aws.iam.RolePolicyAttachment(
            f"{name}-pulumi-role-power-user",
            role=self.pulumi_role.name,
            policy_arn=aws.iam.ManagedPolicy.POWER_USER_ACCESS,
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.iam.RolePolicy(
            f"{name}-pulumi-role-iam",
            role=self.pulumi_role.name,
            policy=_pulumi_policy(
                args.account_id, args.state_bucket_arn, args.secrets_key_arn
            ),
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.register_outputs(
            {
                "preview_role": self.preview_role,
                "pulumi_role": self.pulumi_role,
            }
        )
