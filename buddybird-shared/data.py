from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_aws as aws


@dataclass(frozen=True)
class DbNetworkArgs:
    subnet_group_name: str
    subnet_ids: pulumi.Input[Sequence[pulumi.Input[str]]]


class DbNetwork(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: DbNetworkArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:DbNetwork", name, None, opts)

        self.subnet_group = aws.rds.SubnetGroup(
            f"{name}-subnet-group",
            name=args.subnet_group_name,
            subnet_ids=args.subnet_ids,
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.register_outputs({"subnet_group": self.subnet_group})
