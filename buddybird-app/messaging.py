from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_aws as aws
from pulumi_aws.iam import (
    GetPolicyDocumentStatementArgs,
    GetPolicyDocumentStatementConditionArgs,
    GetPolicyDocumentStatementPrincipalArgs,
    PolicyStatementEffect,
)

from schedule import scheduler_assume_role_policy

UPLOAD_CONFIRMATION = "upload-confirmation"
PARROT_SOUND_DETECTION = "parrot-sound-detection"
MIMICRY_JUDGMENT = "mimicry-judgment"
JUDGMENT_RESULT = "judgment-result"
NOTIFICATION = "notification"
WITHDRAWAL = "withdrawal"
PERIODIC_COMMAND = "periodic-command"

QUEUE_VISIBILITY_TIMEOUTS = {
    UPLOAD_CONFIRMATION: 60,
    PARROT_SOUND_DETECTION: 300,
    MIMICRY_JUDGMENT: 300,
    JUDGMENT_RESULT: 30,
    NOTIFICATION: 30,
    WITHDRAWAL: 300,
    PERIODIC_COMMAND: 30,
}

QUEUE_RETENTION_SECONDS = {PERIODIC_COMMAND: 60}

MAX_RECEIVE_COUNT = 5
DLQ_RETENTION_SECONDS = 14 * 24 * 60 * 60
DLQ_ALARM_PERIOD_SECONDS = 300

UPLOAD_KEY_PATTERNS = [
    {"prefix": "upload/"},
    {"wildcard": "user/*/word/*"},
    {"wildcard": "user/*/session/*"},
]

TICK_SCHEDULE = "rate(1 minute)"
TICK_MESSAGES = [
    ("withdrawal-dispatch", "withdrawal.dispatch"),
    ("heartbeat-check", "session.check_heartbeats"),
]


@dataclass(frozen=True)
class MessagingArgs:
    name_prefix: str
    data_bucket_name: pulumi.Input[str]
    alarm_emails: Sequence[str]


class Messaging(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: MessagingArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:buddybird:Messaging", name, None, opts)
        child = pulumi.ResourceOptions(parent=self)

        alarm_topic = aws.sns.Topic(
            f"{name}-alarm-topic",
            name=f"{args.name_prefix}-alarms",
            opts=child,
        )

        for index, email in enumerate(args.alarm_emails):
            aws.sns.TopicSubscription(
                f"{name}-alarm-subscription-{index}",
                topic=alarm_topic.arn,
                protocol="email",
                endpoint=email,
                opts=child,
            )

        self.queues: dict[str, aws.sqs.Queue] = {}
        self.dead_letter_queues: dict[str, aws.sqs.Queue] = {}

        for suffix, visibility_timeout in QUEUE_VISIBILITY_TIMEOUTS.items():
            dead_letter_queue = aws.sqs.Queue(
                f"{name}-{suffix}-dlq",
                name=f"{args.name_prefix}-{suffix}-dlq",
                message_retention_seconds=DLQ_RETENTION_SECONDS,
                opts=child,
            )

            self.dead_letter_queues[suffix] = dead_letter_queue

            self.queues[suffix] = aws.sqs.Queue(
                f"{name}-{suffix}",
                name=f"{args.name_prefix}-{suffix}",
                visibility_timeout_seconds=visibility_timeout,
                message_retention_seconds=QUEUE_RETENTION_SECONDS.get(suffix),
                redrive_policy=pulumi.Output.json_dumps(
                    {
                        "deadLetterTargetArn": dead_letter_queue.arn,
                        "maxReceiveCount": MAX_RECEIVE_COUNT,
                    }
                ),
                opts=child,
            )

            aws.cloudwatch.MetricAlarm(
                f"{name}-{suffix}-dlq-alarm",
                name=f"{args.name_prefix}-{suffix}-dlq",
                namespace="AWS/SQS",
                metric_name="ApproximateNumberOfMessagesVisible",
                dimensions={"QueueName": dead_letter_queue.name},
                statistic="Maximum",
                period=DLQ_ALARM_PERIOD_SECONDS,
                evaluation_periods=1,
                comparison_operator="GreaterThanThreshold",
                threshold=0,
                treat_missing_data="notBreaching",
                alarm_actions=[alarm_topic.arn],
                opts=child,
            )

        self._upload_events(name, args)
        self._ticks(name, args)

        self.register_outputs({"queues": self.queues})

    def _upload_events(self, name: str, args: MessagingArgs) -> None:
        child = pulumi.ResourceOptions(parent=self)
        queue = self.queues[UPLOAD_CONFIRMATION]

        rule = aws.cloudwatch.EventRule(
            f"{name}-upload-created-rule",
            name=f"{args.name_prefix}-upload-created",
            event_pattern=pulumi.Output.json_dumps(
                {
                    "source": ["aws.s3"],
                    "detail-type": ["Object Created"],
                    "detail": {
                        "bucket": {"name": [args.data_bucket_name]},
                        "object": {"key": UPLOAD_KEY_PATTERNS},
                    },
                }
            ),
            opts=child,
        )

        aws.sqs.QueuePolicy(
            f"{name}-{UPLOAD_CONFIRMATION}-policy",
            queue_url=queue.url,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        principals=[
                            GetPolicyDocumentStatementPrincipalArgs(
                                type="Service",
                                identifiers=["events.amazonaws.com"],
                            )
                        ],
                        actions=["sqs:SendMessage"],
                        resources=[queue.arn],
                        conditions=[
                            GetPolicyDocumentStatementConditionArgs(
                                test="ArnEquals",
                                variable="aws:SourceArn",
                                values=[rule.arn],
                            )
                        ],
                    )
                ]
            ).json,
            opts=child,
        )

        aws.cloudwatch.EventTarget(
            f"{name}-upload-created-target",
            rule=rule.name,
            arn=queue.arn,
            opts=child,
        )

    def _ticks(self, name: str, args: MessagingArgs) -> None:
        child = pulumi.ResourceOptions(parent=self)
        queue = self.queues[PERIODIC_COMMAND]

        role = aws.iam.Role(
            f"{name}-scheduler-role",
            name=f"{args.name_prefix}-scheduler",
            assume_role_policy=scheduler_assume_role_policy(),
            opts=pulumi.ResourceOptions.merge(
                child, pulumi.ResourceOptions(delete_before_replace=True)
            ),
        )

        aws.iam.RolePolicy(
            f"{name}-scheduler-role-policy",
            role=role.name,
            policy=aws.iam.get_policy_document_output(
                statements=[
                    GetPolicyDocumentStatementArgs(
                        effect=PolicyStatementEffect.ALLOW,
                        actions=["sqs:SendMessage"],
                        resources=[queue.arn],
                    )
                ]
            ).json,
            opts=child,
        )

        for schedule_name, message_type in TICK_MESSAGES:
            aws.scheduler.Schedule(
                f"{name}-{schedule_name}-schedule",
                name=f"{args.name_prefix}-{schedule_name}",
                schedule_expression=TICK_SCHEDULE,
                flexible_time_window=aws.scheduler.ScheduleFlexibleTimeWindowArgs(
                    mode="OFF"
                ),
                target=aws.scheduler.ScheduleTargetArgs(
                    arn=queue.arn,
                    role_arn=role.arn,
                    input=pulumi.Output.json_dumps({"type": message_type}),
                ),
                opts=child,
            )
