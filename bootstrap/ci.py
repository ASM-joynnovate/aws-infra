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

PREVIEW_ROLE_NAME = "jn-ci-preview"
PULUMI_ROLE_NAME = "jn-ci-pulumi"
CI_ROLE_PATTERN = "jn-ci-*"

READ_ONLY_POLICY_ARN = "arn:aws:iam::aws:policy/ReadOnlyAccess"
POWER_USER_POLICY_ARN = "arn:aws:iam::aws:policy/PowerUserAccess"

ALLOW = "Allow"
DENY = "Deny"

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
                effect=ALLOW,
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
                effect=ALLOW,
                actions=["s3:PutObject", "s3:DeleteObject"],
                resources=[
                    pulumi.Output.format("{0}/.pulumi/locks/*", state_bucket_arn)
                ],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DecryptStackSecrets",
                effect=ALLOW,
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
                effect=ALLOW,
                actions=ROLE_WRITE_ACTIONS + POLICY_WRITE_ACTIONS + ["iam:PassRole"],
                resources=["*"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenyPersistentCredentials",
                effect=DENY,
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
                effect=DENY,
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
                effect=DENY,
                actions=ROLE_WRITE_ACTIONS,
                resources=[f"arn:aws:iam::{account_id}:role/{CI_ROLE_PATTERN}"],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenyStateBucketDeletion",
                effect=DENY,
                actions=["s3:DeleteBucket"],
                resources=[state_bucket_arn],
            ),
            GetPolicyDocumentStatementArgs(
                sid="DenySecretsKeyDestruction",
                effect=DENY,
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


def create(account_id, state_bucket_arn, secrets_key_arn):
    provider = aws.iam.OpenIdConnectProvider(
        "github",
        url=OIDC_URL,
        client_id_lists=[OIDC_AUDIENCE],
    )

    preview_role = aws.iam.Role(
        "ci-preview",
        name=PREVIEW_ROLE_NAME,
        description="Read-only role for pulumi preview on pull requests",
        assume_role_policy=_trust_policy(provider.arn, PREVIEW_SUB),
    )

    aws.iam.RolePolicyAttachment(
        "ci-preview-read-only",
        role=preview_role.name,
        policy_arn=READ_ONLY_POLICY_ARN,
    )

    aws.iam.RolePolicy(
        "ci-preview-state",
        role=preview_role.name,
        policy=_preview_policy(state_bucket_arn, secrets_key_arn),
    )

    pulumi_role = aws.iam.Role(
        "ci-pulumi",
        name=PULUMI_ROLE_NAME,
        description="Role for pulumi up after prod environment approval",
        assume_role_policy=_trust_policy(provider.arn, PULUMI_SUB),
    )

    aws.iam.RolePolicyAttachment(
        "ci-pulumi-power-user",
        role=pulumi_role.name,
        policy_arn=POWER_USER_POLICY_ARN,
    )

    aws.iam.RolePolicy(
        "ci-pulumi-iam",
        role=pulumi_role.name,
        policy=_pulumi_policy(account_id, state_bucket_arn, secrets_key_arn),
    )

    return {
        "oidc_provider_arn": provider.arn,
        "preview_role_arn": preview_role.arn,
        "pulumi_role_arn": pulumi_role.arn,
    }
