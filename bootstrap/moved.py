import pulumi


def from_root(parent: pulumi.Resource, old_name: str) -> pulumi.ResourceOptions:
    return pulumi.ResourceOptions(
        parent=parent,
        aliases=[pulumi.Alias(name=old_name, parent=pulumi.ROOT_STACK_RESOURCE)],
    )


def renamed(parent: pulumi.Resource, old_name: str) -> pulumi.ResourceOptions:
    return pulumi.ResourceOptions(
        parent=parent,
        aliases=[pulumi.Alias(name=old_name)],
    )
