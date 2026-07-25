output "state_bucket_name" {
  description = "state 파일을 저장하는 S3 버킷 이름"
  value       = aws_s3_bucket.state.id
}

output "state_bucket_arn" {
  description = "state 버킷 ARN, CI 역할 정책의 리소스 조건에 사용"
  value       = aws_s3_bucket.state.arn
}

output "region" {
  description = "backend가 사용하는 리전"
  value       = local.region
}
