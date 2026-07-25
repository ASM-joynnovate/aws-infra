# 초기 구축

전체 스택 구축 절차

계정 회수 후 재구축할 때도 동일

용어는 [README](../README.md) 하단 용어 표 참고

## 사전 결정

| 값 | 사용처 |
| --- | --- |
| 도메인 | Route 53 hosted zone, ACM 인증서, ALB 호스트 라우팅 |
| state 버킷 접두사 | S3 backend, 계정 regional namespace의 앞부분 |
| GitHub 조직과 저장소 이름 | OIDC 신뢰 정책의 `sub` 조건 |
| 리소스 이름 접두사 | `default_tags`와 리소스 이름 |

### state 버킷 이름

계정 regional namespace로 생성하므로 이름 형식이 정해져 있음

```
<접두사>-<계정 ID>-<리전 코드>-an
joynnovate-tfstate-198252712951-ap-northeast-2-an
```

- 이 네임스페이스의 이름은 해당 계정만 생성 가능하고 버킷을 삭제해도 다른 계정이 가져갈 수 없음
  - 계정 회수로 버킷이 사라진 뒤 재구축할 때 이름을 선점당하지 않음
- 접미사가 63자 제한에 포함되므로 접두사에 32자까지 사용 가능
- `aws_s3_bucket`에 `bucket_namespace = "account-regional"` 지정, AWS provider 6.37.0 이상 필요
- 이름은 `locals.tf`에서 계정 ID와 리전을 읽어 조립하므로 계정을 재발급받아도 수정 불필요

## 실행 순서

```
1. bootstrap
2. platform
3. 네임서버 전환
4. app
```

- 샌드박스 Identity Center 포털로 로그인한 상태에서 1~3단계를 로컬 실행
- 4단계부터 GitHub Actions가 apply를 담당

## 1. bootstrap

- state 버킷 자체를 Terraform으로 만들기 때문에 최초 실행에는 원격 backend 사용 불가
- `backend.tf`가 있으면 아직 없는 버킷을 참조해 `init`이 실패하므로 파일 이름을 바꿔 잠시 치워둠

```bash
cd live/bootstrap
mv backend.tf backend.tf.disabled
terraform init
terraform apply
```

| 리소스 | 내용 |
| --- | --- |
| S3 버킷 | state 저장용<br>버저닝, 서버 측 암호화, public access block, ownership controls 적용<br>미완료 멀티파트 업로드 7일 뒤 정리, 이전 버전 state 90일 뒤 삭제<br>`aws:SecureTransport`가 false인 요청을 버킷 정책이 거부 |

- `prevent_destroy = true`가 걸려 있어 `terraform destroy`로 지워지지 않음
  - 정말 지워야 하면 `lifecycle` 블록을 제거하고 apply한 뒤 destroy

### state 이관

버킷 생성 후 로컬 state를 버킷으로 이동

```bash
mv backend.tf.disabled backend.tf
terraform init -migrate-state
```

- 계정을 재발급받으면 `backend.tf`의 `bucket`을 새 계정 ID가 들어간 이름으로 교체
- 이관을 마치면 남아 있는 `terraform.tfstate`와 `terraform.tfstate.backup`은 옛 사본이므로 삭제

## 2. platform

```bash
cd live/prod/platform
terraform init
terraform apply
```

| 리소스 | 내용 |
| --- | --- |
| VPC와 서브넷 | AZ 2개에 public 2개, private 2개<br>NAT Gateway 없이 S3 gateway endpoint만 연결 |
| 보안 그룹 | ALB용, ECS task용, RDS용 |
| RDS PostgreSQL | db.t4g.small, single-AZ, gp3, private 서브넷<br>`manage_master_user_password = true`로 state에 평문 비밀번호 미저장 |
| S3 버킷 | 애플리케이션 데이터용과 정적 사이트 배포용<br>수명이 다른 데이터는 prefix로 분리하고 prefix별 lifecycle 규칙 적용<br>`AbortIncompleteMultipartUpload` 7일 |
| ECR | 서비스별 컨테이너 이미지 저장소 |
| Route 53 | hosted zone |
| AWS Budgets | 예산 알림<br>샌드박스 한도보다 낮은 임곗값으로 설정해 계정 동결 전에 인지 |
| GitHub OIDC | provider와 역할<br>Terraform apply용, 앱 배포용 |

- 앱 배포용 역할은 ECR push와 ECS 서비스 갱신만 허용

### OIDC 신뢰 정책

```
repo:<조직>@<owner_id>/aws-infra@<repo_id>:ref:refs/heads/main
```

- ID 확인은 `gh api /repos/<조직>/aws-infra --jq '[.owner.id, .id]'`
- AWS가 GitHub을 자체 신뢰 루트 CA로 검증하므로 `thumbprint_list` 생략

## 3. 네임서버 전환

- `terraform output`으로 hosted zone 네임서버 4개 확인
- 확인한 네임서버를 도메인 등록기관에 등록

## 4. app

```bash
cd live/prod/app
terraform init
terraform apply
```

| 리소스 | 내용 |
| --- | --- |
| ACM 인증서 | ALB용은 ap-northeast-2, CloudFront용은 us-east-1<br>provider alias 필요 |
| ALB | 리스너, 서비스별 타깃 그룹, 호스트 기반 라우팅 규칙 |
| ECS | 클러스터와 서비스별 task definition, service<br>task definition은 골격만 생성, 이미지는 placeholder 태그 |
| CloudFront | 정적 사이트 배포용 S3 오리진과 OAC |
| Route 53 | 서비스별 레코드 |

## 확인

| 항목 | 방법 |
| --- | --- |
| state 정합성 | 3개 실행 디렉터리에서 `terraform plan`, 변경 없음 |
| state 잠금 | 두 터미널에서 동시 apply, 두 번째가 412로 차단 |
| 서비스 응답 | ALB DNS로 요청 시 각 서비스가 200 반환 |
| 예산 알림 | `aws budgets describe-budgets` |
| 파이프라인 | 테스트 PR에 plan 코멘트 게시, 머지 시 apply 실행 |
| NAT Gateway 미생성 | `aws ec2 describe-nat-gateways`, 결과 없음 |
| 재현성 | `terraform destroy` 후 다시 apply, 동일 구성 복원 |
