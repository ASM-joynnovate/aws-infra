from collections.abc import Mapping
from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

TIMEZONE = "Asia/Seoul"

ECS_UPDATE_SERVICE_TARGET = "arn:aws:scheduler:::aws-sdk:ecs:updateService"
RDS_STOP_TARGET = "arn:aws:scheduler:::aws-sdk:rds:stopDBInstance"
RDS_START_TARGET = "arn:aws:scheduler:::aws-sdk:rds:startDBInstance"

STOP_SERVICE_CRON = "cron(0 3 * * ? *)"
STOP_DB_CRON = "cron(5 3 * * ? *)"
START_DB_CRON = "cron(50 8 * * ? *)"
START_SERVICE_CRON = "cron(0 9 * * ? *)"


def scheduler_assume_role_policy() -> str:
    return aws.iam.get_policy_document(
        statements=[
            GetPolicyDocumentStatementArgs(
                effect=PolicyStatementEffect.ALLOW,
                actions=["sts:AssumeRole"],
                principals=[
                    GetPolicyDocumentStatementPrincipalArgs(
                        type="Service", identifiers=["scheduler.amazonaws.com"]
                    )
                ],
            )
        ]
    ).json


@dataclass(frozen=True)
class NightlyStopArgs:
    name_prefix: str
    cluster_arn: pulumi.Input[str]
    services: Mapping[str, aws.ecs.Service]
    database: aws.rds.Instance


class NightlyStop(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: NightlyStopArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:NightlyStop", name, None, opts)
        child = pulumi.ResourceOptions(parent=self)

        role = aws.iam.Role(
            f"{name}-role",
            name=f"{args.name_prefix}-nightly-stop",
            assume_role_policy=scheduler_assume_role_policy(),
            opts=pulumi.ResourceOptions.merge(
                child, pulumi.ResourceOptions(delete_before_replace=True)
            ),
        )

        aws.iam.RolePolicy(
            f"{name}-role-policy",
            role=role.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["ecs:UpdateService"],
                        resources=[service.id for service in args.services.values()],
                    ),
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["rds:StopDBInstance", "rds:StartDBInstance"],
                        resources=[args.database.arn],
                    ),
                ]
            ).json,
            opts=child,
        )

        def service_input(
            service: aws.ecs.Service, desired_count: int
        ) -> pulumi.Output[str]:
            return pulumi.Output.json_dumps(
                {
                    "Cluster": args.cluster_arn,
                    "Service": service.name,
                    "DesiredCount": desired_count,
                }
            )

        database_input = pulumi.Output.json_dumps(
            {"DbInstanceIdentifier": args.database.identifier}
        )

        schedules = [
            ("stop-db", STOP_DB_CRON, RDS_STOP_TARGET, database_input),
            ("start-db", START_DB_CRON, RDS_START_TARGET, database_input),
        ]
        for key, service in args.services.items():
            schedules += [
                (
                    f"stop-{key}",
                    STOP_SERVICE_CRON,
                    ECS_UPDATE_SERVICE_TARGET,
                    service_input(service, 0),
                ),
                (
                    f"start-{key}",
                    START_SERVICE_CRON,
                    ECS_UPDATE_SERVICE_TARGET,
                    service_input(service, 1),
                ),
            ]

        for suffix, cron, target_arn, target_input in schedules:
            aws.scheduler.Schedule(
                f"{name}-{suffix}",
                name=f"{args.name_prefix}-{suffix}",
                schedule_expression=cron,
                schedule_expression_timezone=TIMEZONE,
                flexible_time_window=aws.scheduler.ScheduleFlexibleTimeWindowArgs(
                    mode="OFF"
                ),
                target=aws.scheduler.ScheduleTargetArgs(
                    arn=target_arn,
                    role_arn=role.arn,
                    input=target_input,
                ),
                opts=child,
            )

        self.register_outputs({})
