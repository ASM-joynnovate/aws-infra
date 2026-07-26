# 초기 구축

전체 스택을 구축하는 절차

계정 회수 후 재구축할 때도 같은 절차를 적용

용어는 [README](../README.md) 하단 용어 표 참고

## 사전 결정

| 값 | 사용처 |
| --- | --- |
| 도메인과 서비스별 호스트명 | ACM 인증서, CloudFront 별칭, ALB 호스트 라우팅 |
| state 버킷 접두사 | S3 backend, account-regional namespace의 앞부분 |
| GitHub 조직과 저장소 이름 | OIDC 신뢰 정책의 `sub` 조건 |
| 리소스 이름 접두사 | `default_tags`와 리소스 이름 |
| 예산 알림 기준 금액과 수신 주소 | AWS Budgets |

### state 버킷 이름

account-regional namespace로 생성하므로 이름 형식이 정해져 있음

```
<접두사>-<계정 ID>-<리전 코드>-an
joynnovate-tfstate-198252712951-ap-northeast-2-an
```

- 이 형식의 이름은 해당 계정만 만들 수 있고 버킷을 삭제해도 다른 계정이 가져갈 수 없음
  - 계정 회수로 버킷이 사라진 뒤 재구축할 때 이름을 선점당하지 않음
- 접미사가 63자 제한에 포함되므로 접두사에는 32자까지 사용 가능
- `aws_s3_bucket`에 `bucket_namespace = "account-regional"` 지정
  - AWS provider 6.37.0 이상 필요
- 이름은 `locals.tf`에서 계정 ID와 리전을 읽어 만들므로 계정을 재발급받아도 수정 불필요

## 실행 순서

1. `bootstrap`
2. `platform`
3. `app`
4. Cloudflare 레코드 등록

- 실행 주체
  - 1~3단계는 샌드박스 Identity Center 포털로 로그인한 상태에서 로컬 실행
  - 이후 `platform`과 `app` 변경은 GitHub Actions가 apply를 담당
- 로컬 실행이 필요한 이유
  - `bootstrap`은 CI가 사용할 state 버킷을 생성
  - `platform`은 CI가 사용할 역할을 생성
  - `app` 최초 apply 중에는 사람이 ACM 검증 CNAME을 등록

## 1. bootstrap

- state 버킷 자체를 Terraform으로 만들기 때문에 최초 실행에는 원격 backend 사용 불가
- `backend.tf`가 있으면 아직 없는 버킷을 참조해 `init`이 실패하므로 파일 이름을 바꿔 잠시 제외

```bash
cd live/bootstrap
mv backend.tf backend.tf.disabled
terraform init
terraform apply
```

| 리소스 | 내용 |
| --- | --- |
| S3 버킷 | state 저장용<br>버저닝, 서버 측 암호화, public access block, ownership controls 적용<br>미완료 멀티파트 업로드는 7일 뒤 중단<br>이전 버전 state는 90일 뒤 삭제<br>`aws:SecureTransport`가 false인 요청을 버킷 정책이 거부 |

- `prevent_destroy = true`가 설정되어 `terraform destroy`로 삭제 불가
  - 정말 삭제해야 하면 `lifecycle` 블록을 제거하고 apply한 뒤 destroy 실행

### state 이관

버킷 생성 후 로컬 state를 버킷으로 이동

```bash
mv backend.tf.disabled backend.tf
terraform init -migrate-state
```

- 계정을 재발급받으면 `backend.tf`의 `bucket`을 새 계정 ID가 들어간 이름으로 교체
- 이관이 끝나면 남아 있는 `terraform.tfstate`와 `terraform.tfstate.backup`은 옛 사본이므로 삭제

## 2. platform

```bash
cd live/prod/platform
terraform init
terraform apply
```

| 리소스 | 내용 |
| --- | --- |
| VPC와 서브넷 | AZ 2개에 public 서브넷 2개와 private 서브넷 2개<br>NAT Gateway 없이 S3 gateway endpoint만 연결 |
| 보안 그룹 | ALB용, ECS task용, RDS용 |
| RDS PostgreSQL | db.t4g.small, single-AZ, gp3, private 서브넷<br>`manage_master_user_password = true`로 state에 평문 비밀번호 미저장 |
| S3 버킷 | 애플리케이션 데이터용과 정적 사이트 배포용<br>수명이 다른 데이터는 prefix로 분리하고 prefix별 lifecycle 규칙 적용<br>`AbortIncompleteMultipartUpload` 7일 |
| ECR | 서비스별 컨테이너 이미지 저장소 |
| AWS Budgets | 예산 알림<br>샌드박스 한도보다 낮은 금액으로 설정해 계정 동결 전에 알림 수신 |
| GitHub OIDC | provider와 역할<br>역할은 Terraform apply용과 앱 배포용 2개 |

- 앱 배포용 역할은 ECR push와 ECS 서비스 갱신만 허용

### OIDC 신뢰 정책

```
repo:<조직>@<owner_id>/aws-infra@<repo_id>:ref:refs/heads/main
```

- 조직과 저장소의 숫자 ID는 `gh api /repos/<조직>/aws-infra --jq '[.owner.id, .id]'`로 확인
- AWS가 자체 신뢰 루트 CA 목록으로 GitHub 인증서를 검증하므로 `thumbprint_list` 생략

## 3. app

```bash
cd live/prod/app
terraform init
terraform apply
```

| 리소스 | 내용 |
| --- | --- |
| ACM 인증서 | ALB용은 ap-northeast-2, CloudFront용은 us-east-1에서 발급<br>us-east-1 발급에는 provider alias 필요 |
| ALB | 리스너, 서비스별 타깃 그룹, 호스트 기반 라우팅 규칙 |
| ECS | 클러스터, 서비스별 task definition과 service<br>task definition은 골격만 생성<br>이미지는 placeholder 태그로 지정 |
| CloudFront | 정적 사이트 배포용 S3 오리진과 OAC |

- apply가 ACM 검증을 기다리며 멈추면 `terraform output`에 나온 검증 CNAME을 Cloudflare에 등록

## 4. Cloudflare 레코드 등록

- CloudFront 배포 도메인을 사이트 호스트명의 CNAME으로 등록
- Cloudflare 프록시는 끈 상태로 등록

## 확인

| 항목 | 방법 |
| --- | --- |
| state 정합성 | 3개 실행 디렉터리에서 `terraform plan` 실행 시 변경 없음 |
| state 잠금 | 두 터미널에서 동시에 apply 실행 시 두 번째가 412로 차단 |
| 서비스 응답 | ALB DNS로 요청 시 각 서비스가 200 반환 |
| 예산 알림 | `aws budgets describe-budgets`로 설정 확인 |
| 파이프라인 | 테스트 PR에 plan 코멘트 게시<br>머지 시 apply 실행 |
| NAT Gateway 미생성 | `aws ec2 describe-nat-gateways` 실행 시 결과 없음 |
| 재현성 | `terraform destroy` 후 다시 apply 시 동일 구성 복원 |
