# aws-infra

다희혁 팀의 AWS 인프라를 관리하는 Terraform 저장소

## 운영 환경

| 항목 | 값 |
| --- | --- |
| 리전 | ap-northeast-2 |
| Terraform | 1.15 이상 |
| AWS provider | 6.x |
| 계정 | Innovation Sandbox on AWS로 임대한 단일 계정 |

## 샌드박스 계정 제약

임대 계정은 상위 조직의 멤버 계정이며 OU에 SCP가 적용됨

### 운영 정책

- 리스가 만료되면 샌드박스가 계정을 회수하고 AWS Nuke가 사용자가 만든 리소스를 전부 삭제
  - RDS 데이터, S3 객체, state 파일이 함께 사라지므로 `terraform apply`로 전체 재생성
  - 보존할 데이터는 계정 밖에 따로 백업
- 예산 한도에 도달하면 샌드박스가 리소스 생성을 차단하고 실행 중인 리소스를 정지
  - 서비스가 멈추므로 예산을 요금보다 우선해 관리
- 멤버 계정이라 조직과 하위 계정을 만들 수 없어 단일 계정 구성으로 고정

### SCP가 거부하는 작업

| 거부 대상 | 영향 |
| --- | --- |
| `sts:GetAccessKeyInfo`, `sts:DecodeAuthorizationMessage` | 권한 실패 메시지를 해독할 수 없어 원문 오류 텍스트만 근거로 남음 |
| `cloudtrail:LookupEvents` | 이벤트 조회 불가, CloudTrail 미구성 |
| `ce:GetCostAndUsage`, `ce:GetAnomalyMonitors`, `ce:GetAnomalySubscriptions` | Cost Explorer와 Cost Anomaly Detection 조회 불가 |
| `account:GetContactInformation`, `account:GetAlternateContact` | 계정 연락처 조회 불가 |
| `route53domains:ListDomains` | 도메인 등록과 이전 불가 |

- `sts:GetFederationToken`도 거부 대상이나 오류 메시지에 SCP로 드러나지 않음
- `account:DeleteAlternateContact`는 실제 삭제가 필요해 확인하지 않음
- 거부되지 않는 작업
  - `sts:AssumeRole`
  - `iam:CreateUser`
    - 생성은 가능하나 IAM 사용자와 액세스 키를 만들지 않기로 결정
  - `ce:CreateAnomalyMonitor`
    - 생성은 되나 조회가 막혀 사용하지 않음
- 계정 접근은 샌드박스가 제공하는 Identity Center 포털 사용

## 구조

```
modules/          재사용 모듈
live/
  bootstrap/      state 버킷, 계정 전역
  prod/
    platform/     VPC, 보안 그룹, RDS, S3, ECR, OIDC 역할, 예산 알림
    app/          ACM, ALB, ECS, CloudFront
```

- `live/` 아래에서 하위 디렉터리가 더 없는 곳이 실행 디렉터리
- 실행 디렉터리마다 state 파일 하나 생성
- state key는 실행 디렉터리의 `backend.tf`에 직접 명시
  - `-backend-config`와 workspace 미사용
  - 디렉터리를 잘못 지정하면 실행 불가
- 환경별 값은 실행 디렉터리의 `locals.tf`에 정의
  - `*.tfvars`가 저장소에서 제외되므로 tfvars 파일 미사용

### 레이어 배치 규칙

destroy 후 재생성 가능하면 `app`에, 데이터가 사라지면 `platform`에 배치

| 레이어 | 변경 주기 | destroy 결과 |
| --- | --- | --- |
| platform | 분기에 한 번 | 데이터 손실 |
| app | 스프린트마다 | 재생성 가능 |

- `app`을 잘못 apply해도 RDS에는 영향 없음
- `app`은 `platform`의 출력값을 `terraform_remote_state`로 조회
  - 의존은 단방향이며 `platform`은 `app`을 참조하지 않음

## 인증

backend와 provider가 같은 AWS 자격 증명을 공유

| 실행 위치 | 방식 |
| --- | --- |
| 로컬 | 샌드박스 Identity Center 포털로 SSO 로그인 |
| GitHub Actions | OIDC로 `platform`이 생성한 역할을 assume |

- 액세스 키 미생성
- provider에 `assume_role` 블록 미사용
- 역할 체이닝을 만들지 않고 권한은 각 역할에 직접 부여
- OIDC의 `AssumeRoleWithWebIdentity`는 호출 주체가 계정 밖이라 SCP 평가 대상이 아님
  - assume이 끝난 CI 역할 세션은 계정 안의 역할이므로 이후 호출부터 SCP를 그대로 받음
- OIDC 신뢰 정책의 `sub`는 immutable 형식 사용
  - 2026-07-15 이후 만든 저장소는 immutable sub를 발급하므로 이름 기반 조건은 동작하지 않음
  - GitHub API의 `use_immutable_subject`는 실제 발급값과 다르게 응답해 근거로 사용하지 않음

## DNS

| 대상 | 관리 주체 |
| --- | --- |
| 네임서버와 DNS 레코드 전체 | Cloudflare |
| ACM 인증서 | Terraform |
| CloudFront 배포와 별칭 | Terraform |

- Route 53 hosted zone 미생성
  - 계정이 회수되면 AWS Nuke가 hosted zone까지 지워 도메인과 이메일 포워딩이 함께 끊김
  - Cloudflare에 두면 회수 시 CloudFront만 사라지고 DNS는 유지됨
- CloudFront용 ACM 인증서는 us-east-1에서 발급
- ACM 검증 CNAME은 사람이 Cloudflare에 등록
  - 등록 전까지 `aws_acm_certificate_validation`이 완료를 기다려 apply가 멈춤
- CloudFront를 가리키는 레코드도 사람이 Cloudflare에 등록
  - 루트 도메인은 CNAME flattening으로 CloudFront를 직접 지정
  - CloudFront가 직접 응답하도록 Cloudflare 프록시를 끈 상태로 등록

## 실행

```bash
cd live/prod/app
terraform init
terraform plan
```

| 디렉터리 | 실행 주체 |
| --- | --- |
| `bootstrap` | 사람이 직접 실행 |
| `prod/platform`, `prod/app` | main에 머지될 때 GitHub Actions가 apply |

- `bootstrap`은 CI가 사용할 state 버킷 자체를 생성하므로 사람이 실행
- 최초 구축에서는 `platform`이 CI가 사용할 역할을 생성하므로 `platform`까지 로컬 실행

## 배포

- 실제 배포는 각 앱 저장소의 워크플로가 담당
  - ECR에 이미지를 올린 뒤 새 revision을 등록해 서비스 갱신
- Terraform은 ECS task definition의 골격만 생성
  - 이미지 태그는 최초 1회만 지정
- 이 분담을 지키도록 ECS 서비스에 `ignore_changes = [task_definition]` 적용
  - `ignore_changes`가 ALB 연결 변경까지 함께 무시
  - ALB 연결이나 컨테이너 포트를 변경할 때는 lifecycle 블록을 주석 처리한 뒤 apply

## 초기 구축

구축 절차는 [docs/bootstrap.md](docs/bootstrap.md) 참고

## 용어

| 용어 | 뜻 |
| --- | --- |
| OU | 조직 안에서 계정을 묶는 단위 |
| SCP | 조직이 멤버 계정에 강제하는 거부 정책으로 계정 안에서는 해제 불가 |
| 리스 | 샌드박스가 계정을 빌려주는 기간 |
| AWS Nuke | 계정 안의 리소스를 일괄 삭제하는 도구 |
| state | Terraform이 생성한 리소스 목록을 기록한 파일 |
| 412 | 잠금이 이미 걸려 있을 때 S3 조건부 쓰기가 반환하는 HTTP 응답 코드 |
| OIDC | 외부 신원 공급자를 신뢰해 액세스 키 없이 AWS 역할을 맡게 하는 방식 |
| 역할 체이닝 | 역할을 맡은 상태에서 다시 다른 역할을 맡는 구성 |
| immutable sub | 조직과 저장소를 이름 대신 숫자 ID로 지목하는 `sub` 클레임 형식 |
| thumbprint | OIDC 공급자 TLS 인증서의 지문 |
| AZ | 한 리전 안에서 물리적으로 분리된 데이터센터 묶음 |
| hosted zone | 한 도메인의 DNS 레코드를 담는 Route 53 단위 |
| CNAME flattening | CNAME을 둘 수 없는 루트 도메인에서 Cloudflare가 CNAME을 미리 풀어 IP로 응답하는 기능 |
| gateway endpoint | NAT Gateway 없이 VPC에서 S3로 통신하게 하는 경로 |
| OAC | CloudFront만 S3 버킷을 읽게 하는 접근 제어 설정 |
