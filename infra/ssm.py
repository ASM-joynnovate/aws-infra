import pulumi_aws as aws

SSM_MANAGED_POLICY_ARN = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"


def bastion(name, subnet, security_group):
    ami = aws.ec2.get_ami(
        owners=["amazon"],
        most_recent=True,
        filters=[
            aws.ec2.GetAmiFilterArgs(name="name", values=["al2023-ami-*-arm64"]),
            aws.ec2.GetAmiFilterArgs(name="architecture", values=["arm64"]),
            aws.ec2.GetAmiFilterArgs(name="virtualization-type", values=["hvm"]),
        ],
    )

    role = aws.iam.Role(
        "ssm",
        name=f"{name}-ssm",
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
    )

    aws.iam.RolePolicyAttachment(
        "ssm",
        role=role.name,
        policy_arn=SSM_MANAGED_POLICY_ARN,
    )

    profile = aws.iam.InstanceProfile("ssm", name=f"{name}-ssm", role=role.name)

    return aws.ec2.Instance(
        "ssm",
        ami=ami.id,
        instance_type=aws.ec2.InstanceType.T4G_NANO,
        subnet_id=subnet.id,
        vpc_security_group_ids=[security_group.id],
        iam_instance_profile=profile.name,
        metadata_options=aws.ec2.InstanceMetadataOptionsArgs(
            http_tokens="required",
            http_endpoint="enabled",
        ),
        tags={"Name": f"{name}-ssm"},
    )
