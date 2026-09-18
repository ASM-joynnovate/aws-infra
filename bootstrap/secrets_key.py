from dataclasses import dataclass

import pulumi
import pulumi_aws as aws


@dataclass(frozen=True)
class SecretsKeyArgs:
    alias_name: str


class SecretsKey(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: SecretsKeyArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:bootstrap:SecretsKey", name, None, opts)

        self.key = aws.kms.Key(
            f"{name}-key",
            description="Pulumi 스택 secret 암호화",
            deletion_window_in_days=7,
            enable_key_rotation=True,
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(protect=True),
            ),
        )

        aws.kms.Alias(
            f"{name}-alias",
            name=args.alias_name,
            target_key_id=self.key.key_id,
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.register_outputs({"key": self.key})
