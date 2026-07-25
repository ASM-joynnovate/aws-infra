output "vpc_id" {
  description = "생성한 VPC ID"
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC CIDR 블록, 보안 그룹 규칙의 출발지 조건에 사용"
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "가용 영역 순서대로 정렬한 public 서브넷 ID 목록"
  value       = [for az in var.azs : aws_subnet.public[az].id]
}

output "private_subnet_ids" {
  description = "가용 영역 순서대로 정렬한 private 서브넷 ID 목록"
  value       = [for az in var.azs : aws_subnet.private[az].id]
}

output "azs" {
  description = "서브넷을 배치한 가용 영역 목록"
  value       = var.azs
}

output "s3_gateway_endpoint_id" {
  description = "S3 gateway endpoint ID, 미생성 시 null"
  value       = try(aws_vpc_endpoint.s3[0].id, null)
}
