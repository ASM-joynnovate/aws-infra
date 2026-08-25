import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
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
                effect="Allow",
                actions=["s3:PutObject", "s3:DeleteObject"],
                resources=[
                    pulumi.Output.format("{0}/.pulumi/locks/*", state_bucket_arn)
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DecryptStackSecrets",
                effect="Allow",
                actions=["kms:Decrypt"],
                resources=[secrets_key_arn],
            ),
        ]
    ).json


def _pulumi_policy(account_id, state_bucket_arn, secrets_key_arn):
    return aws.iam.get_policy_document_output(
        statements=[
            GetPolicyDocumentStatementArgs(
                sid="ManageServiceRoles",
                effect="Allow",
                actions=ROLE_WRITE_ACTIONS + POLICY_WRITE_ACTIONS + ["iam:PassRole"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenyPersistentCredentials",
                effect="Deny",
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
                effect="Deny",
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
                effect="Deny",
                actions=ROLE_WRITE_ACTIONS,
                resources=[f"arn:aws:iam::{account_id}:role/{CI_ROLE_PREFIX}-*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenyStateBucketDeletion",
                effect="Deny",
                actions=["s3:DeleteBucket"],
                resources=[state_bucket_arn],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenySecretsKeyDestruction",
                effect="Deny",
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


class CiRoles(pulumi.ComponentResource):
    def __init__(self, name, account_id, state_bucket_arn, secrets_key_arn, opts=None):
        super().__init__("joynnovate:bootstrap:CiRoles", name, None, opts)
        child = pulumi.ResourceOptions(
            parent=self,
            aliases=[pulumi.Alias(parent=pulumi.ROOT_STACK_RESOURCE)],
        )

        provider = aws.iam.OpenIdConnectProvider(
            "github",
            url=OIDC_URL,
            client_id_lists=[OIDC_AUDIENCE],
            opts=child,
        )

        self.preview_role = aws.iam.Role(
            "ci-preview",
            name=PREVIEW_ROLE_NAME,
            description="Read-only role for pulumi preview on pull requests",
            assume_role_policy=_trust_policy(provider.arn, PREVIEW_SUB),
            opts=child,
        )

        aws.iam.RolePolicyAttachment(
            "ci-preview-read-only",
            role=self.preview_role.name,
            policy_arn=aws.iam.ManagedPolicy.READ_ONLY_ACCESS,
            opts=child,
        )

        aws.iam.RolePolicy(
            "ci-preview-state",
            role=self.preview_role.name,
            policy=_preview_policy(state_bucket_arn, secrets_key_arn),
            opts=child,
        )

        self.pulumi_role = aws.iam.Role(
            "ci-pulumi",
            name=PULUMI_ROLE_NAME,
            description="Role for pulumi up after prod environment approval",
            assume_role_policy=_trust_policy(provider.arn, PULUMI_SUB),
            opts=child,
        )

        aws.iam.RolePolicyAttachment(
            "ci-pulumi-power-user",
            role=self.pulumi_role.name,
            policy_arn=aws.iam.ManagedPolicy.POWER_USER_ACCESS,
            opts=child,
        )

        aws.iam.RolePolicy(
            "ci-pulumi-iam",
            role=self.pulumi_role.name,
            policy=_pulumi_policy(account_id, state_bucket_arn, secrets_key_arn),
            opts=child,
        )

        self.register_outputs(
            {
                "preview_role": self.preview_role,
                "pulumi_role": self.pulumi_role,
            }
        )
