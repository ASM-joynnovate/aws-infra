import hashlib
from dataclasses import dataclass
from pathlib import Path

import pulumi
import pulumi_cloudflare as cloudflare

CLOUDFLARE_ZONE_ID = "fa5a1e637498dd11b4bf43211181f9e8"
OTA_NAME = "jn-buddybird-ota"
OTA_HOSTNAME = "ota.buddybird.xyz"
OTA_WORKER_FILE = Path(__file__).parent / "ota" / "index.js"
OTA_COMPATIBILITY_DATE = "2026-08-13"
OTA_COMPATIBILITY_FLAGS = ["nodejs_compat"]


@dataclass(frozen=True)
class OtaArgs:
    r2_access_key_id: pulumi.Input[str] | None
    r2_secret_access_key: pulumi.Input[str] | None


class Ota(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: OtaArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:Ota", name, None, opts)

        self.account_id = cloudflare.get_zone(zone_id=CLOUDFLARE_ZONE_ID).account.id

        self.bucket = cloudflare.R2Bucket(
            f"{name}-bucket",
            account_id=self.account_id,
            name=OTA_NAME,
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.database = cloudflare.D1Database(
            f"{name}-database",
            account_id=self.account_id,
            name=OTA_NAME,
            opts=pulumi.ResourceOptions(parent=self),
        )

        r2_keys_configured = (
            args.r2_access_key_id is not None and args.r2_secret_access_key is not None
        )

        if r2_keys_configured:
            worker = cloudflare.WorkersScript(
                f"{name}-worker",
                account_id=self.account_id,
                script_name=OTA_NAME,
                main_module="index.js",
                content_file=str(OTA_WORKER_FILE),
                content_sha256=hashlib.sha256(OTA_WORKER_FILE.read_bytes()).hexdigest(),
                compatibility_date=OTA_COMPATIBILITY_DATE,
                compatibility_flags=OTA_COMPATIBILITY_FLAGS,
                cache_options=cloudflare.WorkersScriptCacheOptionsArgs(enabled=True),
                observability=cloudflare.WorkersScriptObservabilityArgs(enabled=True),
                bindings=[
                    cloudflare.WorkersScriptBindingArgs(
                        name="DB",
                        type="d1",
                        id=self.database.id,
                    ),
                    cloudflare.WorkersScriptBindingArgs(
                        name="BUCKET",
                        type="r2_bucket",
                        bucket_name=self.bucket.name,
                    ),
                    cloudflare.WorkersScriptBindingArgs(
                        name="ACCOUNT_ID",
                        type="plain_text",
                        text=self.account_id,
                    ),
                    cloudflare.WorkersScriptBindingArgs(
                        name="BUCKET_NAME",
                        type="plain_text",
                        text=self.bucket.name,
                    ),
                    cloudflare.WorkersScriptBindingArgs(
                        name="R2_ACCESS_KEY_ID",
                        type="secret_text",
                        text=args.r2_access_key_id,
                    ),
                    cloudflare.WorkersScriptBindingArgs(
                        name="R2_SECRET_ACCESS_KEY",
                        type="secret_text",
                        text=args.r2_secret_access_key,
                    ),
                ],
                opts=pulumi.ResourceOptions(parent=self),
            )

            cloudflare.WorkersCustomDomain(
                f"{name}-domain",
                account_id=self.account_id,
                hostname=OTA_HOSTNAME,
                service=worker.script_name,
                zone_id=CLOUDFLARE_ZONE_ID,
                opts=pulumi.ResourceOptions(parent=self),
            )

        self.register_outputs(
            {
                "account_id": self.account_id,
                "bucket": self.bucket,
                "database": self.database,
            }
        )
