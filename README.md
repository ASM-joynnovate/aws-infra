# aws-infra

다희혁 팀의 AWS 인프라를 관리하는 Terraform 저장소

- 리전: ap-northeast-2
- Terraform 1.15 이상, AWS provider 6.x
- Innovation Sandbox on AWS로 임대받은 단일 계정에서 운영

## 샌드박스 계정 제약

임대 계정은 상위 조직의 멤버 계정이며 OU에 SCP가 적용됨

### 운영 정책

| 제약 | 영향 |
| --- | --- |
| 리스 만료와 계정 회수 | AWS Nuke가 사용자가 만든 리소스를 전부 삭제<br>RDS 데이터, S3 객체, state 파일이 함께 사라지므로 `terraform apply`로 전체 재생성 |
| 예산 한도 도달 | 리소스 생성 차단, 실행 중인 리소스 정지 |
| 멤버 계정 | 조직과 하위 계정 생성 불가, 단일 계정 구성 고정 |

- 보존할 데이터는 계정 밖에 따로 백업
- 한도에 닿으면 서비스가 멈추므로 예산을 요금보다 우선해 관리

### SCP가 거부하는 작업

| 거부 대상 | 영향 |
| --- | --- |
| `sts:AssumeRole`, `sts:GetFederationToken`, `sts:GetAccessKeyInfo` | provider의 `assume_role`과 역할 체이닝 사용 불가 |
| `sts:DecodeAuthorizationMessage`, `cloudtrail:LookupEvents` | 권한 실패 메시지 해독과 이벤트 조회 불가<br>원문 오류 텍스트만 근거로 남아 CloudTrail 미구성 |
| `ce:CreateAnomalyMonitor`, `ce:GetCostAndUsage` | Cost Anomaly Detection과 Cost Explorer 미사용 |
| `account:GetContactInformation`, `account:DeleteAlternateContact` | 계정 연락처와 결제 관련 설정 조회와 변경 불가 |
| `route53domains:ListDomains` | 도메인 등록과 이전 불가, hosted zone 생성은 가능 |

- IAM 사용자와 액세스 키 생성은 SCP가 막지 않지만 만들지 않기로 결정
- 계정 접근은 샌드박스가 제공하는 Identity Center 포털을 사용

## 구조

```
modules/          재사용 모듈, 리소스 정의
live/
  bootstrap/      state 버킷, 계정 전역
  prod/
    platform/     VPC, 보안 그룹, RDS, S3, ECR, Route 53 존, OIDC 역할, 예산 알림
    app/          ACM, ALB, ECS, CloudFront, DNS 레코드
```

- `live/` 아래에서 하위 디렉터리가 더 없는 곳이 실행 디렉터리
- 실행 디렉터리마다 state 파일이 하나씩 생성
- state key는 실행 디렉터리의 `backend.tf`에 직접 명시
  - `-backend-config`와 workspace 미사용, 디렉터리를 잘못 지정하면 실행 불가
- 환경별 값은 실행 디렉터리의 `locals.tf`에 정의
  - `*.tfvars`가 저장소에서 제외되므로 tfvars 파일 미사용

### 레이어 배치 규칙

- destroy 후 재생성 가능하면 `app`에, 데이터가 사라지면 `platform`에 배치

| 레이어 | 변경 주기 | destroy하면 |
| --- | --- | --- |
| platform | 분기에 한 번 | 데이터 손실 |
| app | 스프린트마다 | 재생성 가능 |

- `app`을 잘못 apply해도 RDS에는 영향 없음
- `app`은 `platform`의 출력값을 `terraform_remote_state`로 조회
  - 의존 방향은 단방향, `platform`은 `app`을 참조하지 않음

## 인증

backend와 provider가 같은 AWS 자격 증명을 공유

| 실행 위치 | 방식 |
| --- | --- |
| 로컬 | 샌드박스 Identity Center 포털로 SSO 로그인 |
| GitHub Actions | OIDC로 `platform`이 생성한 역할을 assume |

- 액세스 키를 생성하지 않음
- provider에 `assume_role` 블록을 사용하지 않음
  - SCP가 `sts:AssumeRole`을 허용하지 않아 실패하고, 원인 추적 수단도 함께 막혀 있음
- 역할이 다른 역할을 assume하는 구성을 만들지 않고 권한은 각 역할에 직접 부여
- OIDC의 `AssumeRoleWithWebIdentity`는 호출 주체가 계정 밖이라 SCP 평가 대상이 아님
  - assume이 끝난 CI 역할 세션은 계정 안의 역할이므로 이후 호출부터 SCP를 그대로 받음
- OIDC 신뢰 정책의 `sub`는 immutable 형식 사용
  - 2026-07-15 이후 생성된 저장소는 immutable sub를 발급하므로 이름 기반은 legacy로 거부됨
  - GitHub API의 `use_immutable_subject`는 실제 발급값과 다르게 응답하므로 근거로 사용하지 않음

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
- 최초 구축 시 `platform`이 CI가 사용할 역할을 생성하므로 `platform`까지 로컬 실행

## 배포와 이미지 태그

- Terraform은 ECS task definition의 골격만 생성하고 이미지 태그는 최초 1회만 지정
- 실제 배포는 각 앱 저장소의 워크플로가 담당
  - ECR에 이미지를 올린 뒤 새 revision을 등록해 서비스를 갱신
- 위 분담을 지키기 위해 ECS 서비스에 `ignore_changes = [task_definition]` 적용
  - `ignore_changes`는 로드밸런서 연결 변경까지 함께 무시
  - ALB 연결과 컨테이너 포트 변경 시 lifecycle 블록을 주석 처리한 뒤 apply 필요

## 초기 구축

구축 절차는 [docs/bootstrap.md](docs/bootstrap.md) 참고

## 용어

| 용어 | 뜻 |
| --- | --- |
| OU | 조직 안에서 계정을 묶는 단위 |
| SCP | 조직이 멤버 계정에 강제하는 거부 정책<br>계정 안에서는 해제 불가 |
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
| gateway endpoint | NAT Gateway 없이 VPC에서 S3로 통신하게 하는 경로 |
| OAC | CloudFront만 S3 버킷을 읽게 하는 접근 제어 설정 |
