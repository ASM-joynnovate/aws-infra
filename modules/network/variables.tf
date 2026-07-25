variable "name_prefix" {
  description = "VPC와 하위 리소스 이름에 붙는 접두사"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC에 할당할 CIDR 블록"
  type        = string
}

variable "azs" {
  description = "서브넷을 배치할 가용 영역 목록, public과 private 서브넷이 이 순서를 따름"
  type        = list(string)

  validation {
    condition     = length(var.azs) >= 2
    error_message = "ALB와 RDS가 서브넷 그룹에 2개 이상의 가용 영역을 요구하므로 azs는 2개 이상이어야 한다."
  }
}

variable "public_subnet_cidrs" {
  description = "public 서브넷 CIDR 목록, azs와 길이가 같아야 함"
  type        = list(string)
}

variable "private_subnet_cidrs" {
  description = "private 서브넷 CIDR 목록, azs와 길이가 같아야 함"
  type        = list(string)
}

variable "enable_s3_gateway_endpoint" {
  description = "NAT Gateway 없이 private 서브넷에서 S3에 접근하게 하는 gateway endpoint 생성 여부"
  type        = bool
  default     = true
}
