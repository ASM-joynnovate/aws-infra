from dataclasses import dataclass

import pulumi
import pulumi_aws as aws


@dataclass(frozen=True)
class BastionArgs:
    instance_name: str
    subnet_id: pulumi.Input[str]
    security_group_id: pulumi.Input[str]


class Bastion(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: BastionArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:infra:Bastion", name, None, opts)

        ami = aws.ec2.get_ami(
            owners=["amazon"],
            most_recent=True,
            filters=[
                aws.ec2.GetAmiFilterArgs(
                    name="name", values=["al2023-ami-2023.*-arm64"]
                ),
                aws.ec2.GetAmiFilterArgs(name="architecture", values=["arm64"]),
                aws.ec2.GetAmiFilterArgs(name="virtualization-type", values=["hvm"]),
            ],
        )

        role = aws.iam.Role(
            f"{name}-role",
            name=args.instance_name,
            assume_role_policy=aws.iam.get_policy_document(
                statements=[
                    aws.iam.GetPolicyDocumentStatementArgs(
                        actions=["sts:AssumeRole"],
                        principals=[
                            aws.iam.GetPolicyDocumentStatementPrincipalArgs(
                                type="Service", identifiers=["ec2.amazonaws.com"]
                            )
                        ],
                    )
                ]
            ).json,
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        aws.iam.RolePolicyAttachment(
            f"{name}-role-ssm-core",
            role=role.name,
            policy_arn=aws.iam.ManagedPolicy.AMAZON_SSM_MANAGED_INSTANCE_CORE,
            opts=pulumi.ResourceOptions(parent=self),
        )

        profile = aws.iam.InstanceProfile(
            f"{name}-instance-profile",
            name=args.instance_name,
            role=role.name,
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        self.instance = aws.ec2.Instance(
            f"{name}-instance",
            ami=ami.id,
            instance_type=aws.ec2.InstanceType.T4G_NANO,
            subnet_id=args.subnet_id,
            vpc_security_group_ids=[args.security_group_id],
            iam_instance_profile=profile.name,
            instance_market_options=aws.ec2.InstanceInstanceMarketOptionsArgs(
                market_type="spot",
                spot_options=aws.ec2.InstanceInstanceMarketOptionsSpotOptionsArgs(
                    spot_instance_type="persistent",
                    instance_interruption_behavior="stop",
                ),
            ),
            metadata_options=aws.ec2.InstanceMetadataOptionsArgs(
                http_tokens="required",
                http_endpoint="enabled",
            ),
            tags={"Name": args.instance_name},
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(ignore_changes=["ami"]),
            ),
        )

        self.register_outputs({"instance": self.instance})
