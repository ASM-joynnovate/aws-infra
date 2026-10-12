from dataclasses import dataclass

import pulumi
import pulumi_cloudflare as cloudflare

from dns import CLOUDFLARE_ZONE_ID


@dataclass(frozen=True)
class PetcamTurnArgs:
    key_name: str


class PetcamTurn(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: PetcamTurnArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:PetcamTurn", name, None, opts)

        zone = cloudflare.get_zone_output(
            zone_id=CLOUDFLARE_ZONE_ID,
            opts=pulumi.InvokeOutputOptions(parent=self),
        )

        self.key = cloudflare.CallsTurnApp(
            f"{name}-key",
            account_id=zone.account.id,
            name=args.key_name,
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.register_outputs({"key": self.key})
