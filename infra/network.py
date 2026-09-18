from dataclasses import dataclass

import pulumi
import pulumi_aws as aws

VPC_CIDR = "10.0.0.0/16"
PUBLIC_SUBNET_CIDRS = ["10.0.0.0/24", "10.0.1.0/24"]
PRIVATE_SUBNET_CIDRS = ["10.0.10.0/24", "10.0.11.0/24"]

ANY_IPV4 = "0.0.0.0/0"
ANY_PROTOCOL = "-1"

ALB_PORTS = [80, 443]
DB_PORT = 5432


@dataclass(frozen=True)
class NetworkArgs:
    region: str
    log_bucket_arn: pulumi.Input[str]
    log_prefix: str
    log_bucket_policy: aws.s3.BucketPolicy


class Network(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: NetworkArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:infra:Network", name, None, opts)
        azs = aws.get_availability_zones(state="available").names[:2]

        self.vpc = aws.ec2.Vpc(
            f"{name}-vpc",
            cidr_block=VPC_CIDR,
            enable_dns_support=True,
            enable_dns_hostnames=True,
            tags={"Name": f"{name}-vpc"},
            opts=pulumi.ResourceOptions(parent=self),
        )

        internet_gateway = aws.ec2.InternetGateway(
            f"{name}-igw",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-igw"},
            opts=pulumi.ResourceOptions(parent=self),
        )

        public_route_table = aws.ec2.RouteTable(
            f"{name}-public",
            vpc_id=self.vpc.id,
            routes=[
                aws.ec2.RouteTableRouteArgs(
                    cidr_block=ANY_IPV4,
                    gateway_id=internet_gateway.id,
                )
            ],
            tags={"Name": f"{name}-public"},
            opts=pulumi.ResourceOptions(parent=self),
        )

        private_route_table = aws.ec2.RouteTable(
            f"{name}-private",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-private"},
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.public_subnets = self._subnets(
            name, azs, PUBLIC_SUBNET_CIDRS, "public", public_route_table, True
        )
        self.private_subnets = self._subnets(
            name, azs, PRIVATE_SUBNET_CIDRS, "private", private_route_table, False
        )

        aws.ec2.VpcEndpoint(
            f"{name}-s3-endpoint",
            vpc_id=self.vpc.id,
            service_name=f"com.amazonaws.{args.region}.s3",
            vpc_endpoint_type="Gateway",
            route_table_ids=[public_route_table.id, private_route_table.id],
            tags={"Name": f"{name}-s3-endpoint"},
            opts=pulumi.ResourceOptions(parent=self),
        )

        self._security_groups(name)

        aws.ec2.FlowLog(
            f"{name}-flow-log",
            vpc_id=self.vpc.id,
            traffic_type="ALL",
            log_destination_type="s3",
            log_destination=pulumi.Output.format(
                "{0}/{1}/", args.log_bucket_arn, args.log_prefix
            ),
            tags={"Name": f"{name}-flow-log"},
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(depends_on=[args.log_bucket_policy]),
            ),
        )

        self.register_outputs(
            {
                "vpc": self.vpc,
                "public_subnets": self.public_subnets,
                "private_subnets": self.private_subnets,
                "alb_security_group": self.alb_security_group,
                "task_security_group": self.task_security_group,
                "db_security_group": self.db_security_group,
                "ssm_security_group": self.ssm_security_group,
            }
        )

    def _subnets(
        self,
        name: str,
        azs: list[str],
        cidrs: list[str],
        tier: str,
        route_table: aws.ec2.RouteTable,
        public: bool,
    ) -> list[aws.ec2.Subnet]:
        subnets = []
        for az, cidr in zip(azs, cidrs):
            subnet = aws.ec2.Subnet(
                f"{name}-{tier}-{az}",
                vpc_id=self.vpc.id,
                availability_zone=az,
                cidr_block=cidr,
                map_public_ip_on_launch=public,
                tags={"Name": f"{name}-{tier}-{az}", "Tier": tier},
                opts=pulumi.ResourceOptions(parent=self),
            )
            aws.ec2.RouteTableAssociation(
                f"{name}-{tier}-{az}",
                subnet_id=subnet.id,
                route_table_id=route_table.id,
                opts=pulumi.ResourceOptions(parent=self),
            )
            subnets.append(subnet)
        return subnets

    def _security_groups(self, name: str) -> None:
        self.alb_security_group = aws.ec2.SecurityGroup(
            f"{name}-alb",
            name=f"{name}-alb",
            description="ALB",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-alb"},
            opts=pulumi.ResourceOptions(parent=self),
        )

        for port in ALB_PORTS:
            aws.vpc.SecurityGroupIngressRule(
                f"{name}-alb-{port}",
                security_group_id=self.alb_security_group.id,
                ip_protocol=aws.ec2.ProtocolType.TCP,
                from_port=port,
                to_port=port,
                cidr_ipv4=ANY_IPV4,
                description=f"From internet on {port}",
                opts=pulumi.ResourceOptions(parent=self),
            )

        self.task_security_group = aws.ec2.SecurityGroup(
            f"{name}-task",
            name=f"{name}-task",
            description="ECS task",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-task"},
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.vpc.SecurityGroupIngressRule(
            f"{name}-task-from-alb",
            security_group_id=self.task_security_group.id,
            ip_protocol=ANY_PROTOCOL,
            referenced_security_group_id=self.alb_security_group.id,
            description="From ALB security group, all ports",
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.db_security_group = aws.ec2.SecurityGroup(
            f"{name}-db",
            name=f"{name}-db",
            description="RDS",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-db"},
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.vpc.SecurityGroupIngressRule(
            f"{name}-db-from-task",
            security_group_id=self.db_security_group.id,
            ip_protocol=aws.ec2.ProtocolType.TCP,
            from_port=DB_PORT,
            to_port=DB_PORT,
            referenced_security_group_id=self.task_security_group.id,
            description=f"From ECS task on {DB_PORT}",
            opts=pulumi.ResourceOptions(parent=self),
        )

        self.ssm_security_group = aws.ec2.SecurityGroup(
            f"{name}-ssm",
            name=f"{name}-ssm",
            description="SSM bastion",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-ssm"},
            opts=pulumi.ResourceOptions(parent=self),
        )

        aws.vpc.SecurityGroupIngressRule(
            f"{name}-db-from-ssm",
            security_group_id=self.db_security_group.id,
            ip_protocol=aws.ec2.ProtocolType.TCP,
            from_port=DB_PORT,
            to_port=DB_PORT,
            referenced_security_group_id=self.ssm_security_group.id,
            description=f"From SSM bastion on {DB_PORT}",
            opts=pulumi.ResourceOptions(parent=self),
        )

        groups = [
            ("alb", self.alb_security_group),
            ("task", self.task_security_group),
            ("db", self.db_security_group),
            ("ssm", self.ssm_security_group),
        ]
        for rule_name, security_group in groups:
            aws.vpc.SecurityGroupEgressRule(
                f"{name}-{rule_name}",
                security_group_id=security_group.id,
                ip_protocol=ANY_PROTOCOL,
                cidr_ipv4=ANY_IPV4,
                description="All outbound traffic",
                opts=pulumi.ResourceOptions(parent=self),
            )

        aws.ec2.DefaultSecurityGroup(
            f"{name}-default",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-default-do-not-use"},
            opts=pulumi.ResourceOptions(parent=self),
        )
