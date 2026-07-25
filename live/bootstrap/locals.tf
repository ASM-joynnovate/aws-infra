locals {
  name_prefix = "joynnovate"
  region      = "ap-northeast-2"

  state_bucket_prefix             = "${local.name_prefix}-tfstate"
  state_noncurrent_retention_days = 90

  state_bucket_name = format(
    "%s-%s-%s-an",
    local.state_bucket_prefix,
    data.aws_caller_identity.current.account_id,
    data.aws_region.current.region,
  )

  tags = {
    Project   = local.name_prefix
    ManagedBy = "terraform"
    Layer     = "bootstrap"
  }
}
