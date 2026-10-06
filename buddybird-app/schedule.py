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
START_DB_CRON = "cron(30 7 * * ? *)"
RETRY_START_DB_CRON = "cron(45 7 * * ? *)"
START_SERVICE_CRON = "cron(0 8 * * ? *)"

DLQ_RETENTION_SECONDS = 14 * 24 * 60 * 60
DLQ_ALARM_PERIOD_SECONDS = 300


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
    service: aws.ecs.Service
    database: aws.rds.Instance
    alarm_topic_arn: pulumi.Input[str]


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

        dead_letter_queue = aws.sqs.Queue(
            f"{name}-dlq",
            name=f"{args.name_prefix}-nightly-stop-dlq",
            message_retention_seconds=DLQ_RETENTION_SECONDS,
            opts=child,
        )

        aws.cloudwatch.MetricAlarm(
            f"{name}-dlq-alarm",
            name=f"{args.name_prefix}-nightly-stop-dlq",
            namespace="AWS/SQS",
            metric_name="ApproximateNumberOfMessagesVisible",
            dimensions={"QueueName": dead_letter_queue.name},
            statistic="Maximum",
            period=DLQ_ALARM_PERIOD_SECONDS,
            evaluation_periods=1,
            comparison_operator="GreaterThanThreshold",
            threshold=0,
            treat_missing_data="notBreaching",
            alarm_actions=[args.alarm_topic_arn],
            opts=child,
        )

        aws.iam.RolePolicy(
            f"{name}-role-policy",
            role=role.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["ecs:UpdateService"],
                        resources=[args.service.id],
                    ),
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["rds:StopDBInstance", "rds:StartDBInstance"],
                        resources=[args.database.arn],
                    ),
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["sqs:SendMessage"],
                        resources=[dead_letter_queue.arn],
                    ),
                ]
            ).json,
            opts=child,
        )

        def service_input(desired_count: int) -> pulumi.Output[str]:
            return pulumi.Output.json_dumps(
                {
                    "Cluster": args.cluster_arn,
                    "Service": args.service.name,
                    "DesiredCount": desired_count,
                }
            )

        database_input = pulumi.Output.json_dumps(
            {"DbInstanceIdentifier": args.database.identifier}
        )

        dead_letter_config = aws.scheduler.ScheduleTargetDeadLetterConfigArgs(
            arn=dead_letter_queue.arn
        )

        schedules = [
            (
                "stop-service",
                STOP_SERVICE_CRON,
                ECS_UPDATE_SERVICE_TARGET,
                service_input(0),
                None,
            ),
            ("stop-db", STOP_DB_CRON, RDS_STOP_TARGET, database_input, None),
            (
                "start-db",
                START_DB_CRON,
                RDS_START_TARGET,
                database_input,
                dead_letter_config,
            ),
            (
                "start-db-retry",
                RETRY_START_DB_CRON,
                RDS_START_TARGET,
                database_input,
                None,
            ),
            (
                "start-service",
                START_SERVICE_CRON,
                ECS_UPDATE_SERVICE_TARGET,
                service_input(1),
                None,
            ),
        ]

        for suffix, cron, target_arn, target_input, dead_letter in schedules:
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
                    dead_letter_config=dead_letter,
                ),
                opts=child,
            )

        self.register_outputs({})
