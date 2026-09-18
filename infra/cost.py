from collections.abc import Sequence
from dataclasses import dataclass

import pulumi
import pulumi_aws as aws


@dataclass(frozen=True)
class CostArgs:
    budget_name: str
    limit_usd: int
    alert_percents: Sequence[int]
    emails: Sequence[str]


class Cost(pulumi.ComponentResource):
    def __init__(
        self,
        name: str,
        args: CostArgs,
        opts: pulumi.ResourceOptions | None = None,
    ) -> None:
        super().__init__("joynnovate:infra:Cost", name, None, opts)

        self.budget = aws.budgets.Budget(
            f"{name}-monthly-budget",
            name=args.budget_name,
            budget_type="COST",
            time_unit="MONTHLY",
            limit_amount=str(args.limit_usd),
            limit_unit="USD",
            notifications=[
                aws.budgets.BudgetNotificationArgs(
                    comparison_operator="GREATER_THAN",
                    notification_type="ACTUAL",
                    threshold=percent,
                    threshold_type="PERCENTAGE",
                    subscriber_email_addresses=list(args.emails),
                )
                for percent in args.alert_percents
            ],
            opts=pulumi.ResourceOptions.merge(
                pulumi.ResourceOptions(parent=self),
                pulumi.ResourceOptions(delete_before_replace=True),
            ),
        )

        self.register_outputs({"budget": self.budget})
