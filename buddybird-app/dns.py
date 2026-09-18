import pulumi
import pulumi_cloudflare as cloudflare

CLOUDFLARE_ZONE_ID = "fa5a1e637498dd11b4bf43211181f9e8"
DNS_RECORD_TTL = 300


def cname_record(
    resource_name: str,
    *,
    hostname: str,
    target: pulumi.Input[str],
    opts: pulumi.ResourceOptions,
) -> cloudflare.DnsRecord:
    return cloudflare.DnsRecord(
        resource_name,
        zone_id=CLOUDFLARE_ZONE_ID,
        name=hostname,
        type="CNAME",
        content=target,
        ttl=DNS_RECORD_TTL,
        proxied=False,
        comment="buddybird service",
        opts=opts,
    )
