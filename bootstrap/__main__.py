import pulumi
import pulumi_aws as aws

from ci import CiRoles, CiRolesArgs
from secrets_key import SecretsKey, SecretsKeyArgs
from state import StateBucket, StateBucketArgs

NAME_PREFIX = "jn"
NONCURRENT_RETENTION_DAYS = 90

region = aws.get_region().region
account_id = aws.get_caller_identity().account_id
key_alias = f"alias/{NAME_PREFIX}-pulumi-secrets"

state = StateBucket(
    "state",
    StateBucketArgs(
        bucket_name=f"{NAME_PREFIX}-state-{account_id}-{region}-an",
        noncurrent_retention_days=NONCURRENT_RETENTION_DAYS,
    ),
)

secrets = SecretsKey("secrets", SecretsKeyArgs(alias_name=key_alias))

ci = CiRoles(
    "ci",
    CiRolesArgs(
        account_id=account_id,
        state_bucket_arn=state.bucket.arn,
        secrets_key_arn=secrets.key.arn,
    ),
)

pulumi.export("state_bucket_name", state.bucket.id)
pulumi.export("state_bucket_arn", state.bucket.arn)
pulumi.export("secrets_key_arn", secrets.key.arn)
pulumi.export("secrets_key_alias", key_alias)
pulumi.export("region", region)
pulumi.export("ci_preview_role_arn", ci.preview_role.arn)
pulumi.export("ci_pulumi_role_arn", ci.pulumi_role.arn)
