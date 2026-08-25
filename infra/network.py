import pulumi
import pulumi_aws as aws

VPC_CIDR = "10.0.0.0/16"
PUBLIC_SUBNET_CIDRS = ["10.0.0.0/24", "10.0.1.0/24"]
PRIVATE_SUBNET_CIDRS = ["10.0.10.0/24", "10.0.11.0/24"]

ANY_IPV4 = "0.0.0.0/0"
ANY_PROTOCOL = "-1"

ALB_PORTS = [80, 443]
DB_PORT = 5432
CACHE_PORTS = [6379, 6380]


class Network(pulumi.ComponentResource):
    def __init__(self, name, region, log_bucket, log_prefix, log_bucket_policy, opts=None):
        super().__init__("joynnovate:infra:Network", name, None, opts)
        child = pulumi.ResourceOptions(parent=self)
        azs = aws.get_availability_zones(state="available").names[:2]

        self.vpc = aws.ec2.Vpc(
            "main",
            cidr_block=VPC_CIDR,
            enable_dns_support=True,
            enable_dns_hostnames=True,
            tags={"Name": f"{name}-vpc"},
            opts=child,
        )

        internet_gateway = aws.ec2.InternetGateway(
            "main",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-igw"},
            opts=child,
        )

        public_route_table = aws.ec2.RouteTable(
            "public",
            vpc_id=self.vpc.id,
            routes=[
                aws.ec2.RouteTableRouteArgs(
                    cidr_block=ANY_IPV4,
                    gateway_id=internet_gateway.id,
                )
            ],
            tags={"Name": f"{name}-public"},
            opts=child,
        )

        private_route_table = aws.ec2.RouteTable(
            "private",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-private"},
            opts=child,
        )

        self.public_subnets = self._subnets(
            name, azs, PUBLIC_SUBNET_CIDRS, "public", public_route_table, True, child
        )
        self.private_subnets = self._subnets(
            name, azs, PRIVATE_SUBNET_CIDRS, "private", private_route_table, False, child
        )

        aws.ec2.VpcEndpoint(
            "s3",
            vpc_id=self.vpc.id,
            service_name=f"com.amazonaws.{region}.s3",
            vpc_endpoint_type="Gateway",
            route_table_ids=[public_route_table.id, private_route_table.id],
            tags={"Name": f"{name}-s3-endpoint"},
            opts=child,
        )

        self._security_groups(name, child)

        aws.ec2.FlowLog(
            "vpc",
            vpc_id=self.vpc.id,
            traffic_type="ALL",
            log_destination_type="s3",
            log_destination=pulumi.Output.format("{0}/{1}/", log_bucket.arn, log_prefix),
            tags={"Name": f"{name}-flow-log"},
            opts=pulumi.ResourceOptions(parent=self, depends_on=[log_bucket_policy]),
        )

        self.register_outputs(
            {
                "vpc": self.vpc,
                "public_subnets": self.public_subnets,
                "private_subnets": self.private_subnets,
                "alb_security_group": self.alb_security_group,
                "task_security_group": self.task_security_group,
                "db_security_group": self.db_security_group,
                "cache_security_group": self.cache_security_group,
            }
        )

    def _subnets(self, name, azs, cidrs, tier, route_table, public, child):
        subnets = []
        for az, cidr in zip(azs, cidrs):
            subnet = aws.ec2.Subnet(
                f"{tier}-{az}",
                vpc_id=self.vpc.id,
                availability_zone=az,
                cidr_block=cidr,
                map_public_ip_on_launch=public,
                tags={"Name": f"{name}-{tier}-{az}", "Tier": tier},
                opts=child,
            )
            aws.ec2.RouteTableAssociation(
                f"{tier}-{az}",
                subnet_id=subnet.id,
                route_table_id=route_table.id,
                opts=child,
            )
            subnets.append(subnet)
        return subnets

    def _security_groups(self, name, child):
        self.alb_security_group = aws.ec2.SecurityGroup(
            "alb",
            name=f"{name}-alb",
            description="ALB",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-alb"},
            opts=child,
        )

        for port in ALB_PORTS:
            aws.vpc.SecurityGroupIngressRule(
                f"alb-{port}",
                security_group_id=self.alb_security_group.id,
                ip_protocol=aws.ec2.ProtocolType.TCP,
                from_port=port,
                to_port=port,
                cidr_ipv4=ANY_IPV4,
                description=f"From internet on {port}",
                opts=child,
            )

        self.task_security_group = aws.ec2.SecurityGroup(
            "task",
            name=f"{name}-task",
            description="ECS task",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-task"},
            opts=child,
        )

        aws.vpc.SecurityGroupIngressRule(
            "task-from-alb",
            security_group_id=self.task_security_group.id,
            ip_protocol=ANY_PROTOCOL,
            referenced_security_group_id=self.alb_security_group.id,
            description="From ALB security group, all ports",
            opts=child,
        )

        self.db_security_group = aws.ec2.SecurityGroup(
            "db",
            name=f"{name}-db",
            description="RDS",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-db"},
            opts=child,
        )

        aws.vpc.SecurityGroupIngressRule(
            "db-from-task",
            security_group_id=self.db_security_group.id,
            ip_protocol=aws.ec2.ProtocolType.TCP,
            from_port=DB_PORT,
            to_port=DB_PORT,
            referenced_security_group_id=self.task_security_group.id,
            description=f"From ECS task on {DB_PORT}",
            opts=child,
        )

        self.cache_security_group = aws.ec2.SecurityGroup(
            "cache",
            name=f"{name}-cache",
            description="ElastiCache",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-cache"},
            opts=child,
        )

        for port in CACHE_PORTS:
            aws.vpc.SecurityGroupIngressRule(
                f"cache-from-task-{port}",
                security_group_id=self.cache_security_group.id,
                ip_protocol=aws.ec2.ProtocolType.TCP,
                from_port=port,
                to_port=port,
                referenced_security_group_id=self.task_security_group.id,
                description=f"From ECS task on {port}",
                opts=child,
            )

        groups = [
            ("alb", self.alb_security_group),
            ("task", self.task_security_group),
            ("db", self.db_security_group),
            ("cache", self.cache_security_group),
        ]
        for rule_name, security_group in groups:
            aws.vpc.SecurityGroupEgressRule(
                rule_name,
                security_group_id=security_group.id,
                ip_protocol=ANY_PROTOCOL,
                cidr_ipv4=ANY_IPV4,
                description="All outbound traffic",
                opts=child,
            )

        aws.ec2.DefaultSecurityGroup(
            "default",
            vpc_id=self.vpc.id,
            tags={"Name": f"{name}-default-do-not-use"},
            opts=child,
        )
