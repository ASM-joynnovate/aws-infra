terraform {
  backend "s3" {
    bucket       = "joynnovate-tfstate-198252712951-ap-northeast-2-an"
    key          = "bootstrap/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
