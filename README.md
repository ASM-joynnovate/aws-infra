# aws-infra

buddybird 서비스의 AWS 인프라를 Pulumi로 관리하는 저장소다.

Pulumi 프로젝트 세 개가 계정 기반 자원과 공용 인프라, buddybird 전용 인프라를 나누어 만든다.

애플리케이션 코드와 배포 파이프라인은 각 앱 저장소에 있다.

## 운영 환경

| 항목 | 값 |
| --- | --- |
| 리전 | ap-northeast-2 |
| 계정 | Innovation Sandbox on AWS로 임대한 단일 계정 |
| Pulumi CLI | 3.254.0 이상 |
| pulumi-aws | 7.x |
| Python | 3.14 이상 |
| 패키지 관리 | uv |

## 구조

```
bootstrap/        state 버킷, KMS 키, OIDC provider, CI 역할
infra/            VPC, ECS 클러스터, ALB, ACM, 예산 알림
buddybird-app/    ECR, ECS 서비스, RDS, ElastiCache, S3, CloudFront
docs/             프로젝트별 설계 문서
.github/workflows/ Pulumi preview, apply 워크플로
```

디렉터리마다 Pulumi 프로젝트 하나가 대응

프로젝트마다 `prod` 스택 하나를 둔다.

| 프로젝트 | 디렉터리 | 실행 주체 | 설계 문서 |
| --- | --- | --- | --- |
| `joynnovate-bootstrap` | `bootstrap/` | 사람이 로컬에서 실행 | [docs/bootstrap.md](docs/bootstrap.md) |
| `joynnovate-infra` | `infra/` | GitHub Actions | [docs/infra.md](docs/infra.md) |
| `buddybird-app` | `buddybird-app/` | GitHub Actions | [docs/buddybird-app.md](docs/buddybird-app.md) |

`buddybird-app`은 `joynnovate-infra`가 export한 값을 StackReference로 읽는다.

StackReference는 다른 스택의 출력값을 가져오는 Pulumi 리소스이며, 이 참조 때문에 `joynnovate-infra`를 먼저 적용해야 한다.

앱 저장소가 받는 리소스는 다음과 같다.

| 저장소 | 리소스 |
| --- | --- |
| `buddybird-api` | ECR 저장소, ECS 서비스, ElastiCache 캐시 |
| `buddybird-mbti-web` | ECR 저장소, ECS 서비스 |
| `buddybird-landing` | S3 버킷, CloudFront 배포 |

## state와 secrets

state는 계정 안의 S3 버킷에 저장한다.

```
s3://jn-state-198252712951-ap-northeast-2-an?region=ap-northeast-2
```

세 프로젝트가 같은 백엔드 URL을 사용한다.

프로젝트마다 백엔드 URL을 다르게 지정하면 StackReference가 동작하지 않는다.

스택 명은 `organization/<프로젝트>/prod` 형식이다.

자체 관리 백엔드에서는 조직 자리가 항상 `organization` 상수다.

- `organization/joynnovate-bootstrap/prod`
- `organization/joynnovate-infra/prod`
- `organization/buddybird-app/prod`

스택 secret은 KMS 키로 암호화한다.

세 스택 모두 `Pulumi.prod.yaml`에 다음 secrets provider를 기록한다.

```
awskms://alias/jn-pulumi-secrets?region=ap-northeast-2
```

`Pulumi.prod.yaml`에는 `aws:region`과 `aws:defaultTags`, secrets provider만 둔다.

도메인과 이름 접두사, 예산 금액, VPC CIDR 같은 값은 각 프로젝트의 Python 상수로 둔다.

## 인증

액세스 키와 IAM 사용자는 만들지 않는다.

| 실행 위치 | 방식 |
| --- | --- |
| 로컬 | 샌드박스 Identity Center 포털로 SSO 로그인 |
| GitHub Actions | OIDC로 `bootstrap`이 만든 역할을 assume |

OIDC 신뢰 정책의 `sub` 조건에는 immutable sub 형식을 사용한다.

## 실행

로컬에서 실행하려면 먼저 SSO 로그인하고 백엔드에 로그인한다.

```bash
pulumi login s3://jn-state-198252712951-ap-northeast-2-an?region=ap-northeast-2
```

이후 프로젝트 디렉터리에서 명령을 실행한다.

```bash
cd infra
pulumi preview
```

적용 순서는 `bootstrap`, `infra`, `buddybird-app`이다.

`infra`와 `buddybird-app`은 GitHub Actions가 적용한다.

| 시점 | 동작 |
| --- | --- |
| PR | `pulumi preview` 결과를 PR 코멘트로 게시 |
| Actions 탭에서 수동 실행 | GitHub Environment의 required reviewer 승인 요청 |
| 승인 후 | `pulumi up --refresh` 실행 |

적용은 `joynnovate-infra`가 끝난 뒤 `buddybird-app` 순으로 진행한다.

`--refresh`는 생략할 수 없다.

`buddybird-app`은 ECS 서비스의 task definition을 `ignoreChanges`로 제외한다.

refresh 없이 적용하면 Pulumi가 state에 남은 기존 revision을 다시 보내 앱 배포가 되돌아간다.

## 샌드박스 계정 제약

이 계정은 상위 조직의 멤버 계정이고, 조직이 OU에 SCP를 적용한다.

- 리스가 만료되면 샌드박스가 계정을 회수하고 AWS Nuke가 사용자가 만든 리소스를 전부 삭제
  - RDS 데이터와 S3 객체, state 파일이 함께 사라짐
  - 세 프로젝트를 처음부터 다시 적용해야 함
  - 계정 밖으로 데이터를 백업하는 경로는 만들지 않음
- 예산 한도에 도달하면 샌드박스가 리소스 생성을 차단하고 실행 중인 리소스를 정지
  - 서비스가 멈추므로 샌드박스 한도보다 낮은 금액으로 AWS Budgets 알림을 설정
- 멤버 계정이라 조직과 하위 계정 생성 불가
  - 단일 계정 구성으로 고정

### SCP가 거부하는 작업

| 작업 | 영향 |
| --- | --- |
| `cloudtrail:LookupEvents` | 이벤트 조회 불가 |
| `ce:GetCostAndUsage` | Cost Explorer 조회 불가 |
| `ce:GetAnomalyMonitors` | Cost Anomaly Detection 조회 불가 |
| `ce:GetAnomalySubscriptions` | Cost Anomaly Detection 조회 불가 |
| `account:GetContactInformation` | 계정 연락처 조회 불가 |
| `account:GetAlternateContact` | 계정 연락처 조회 불가 |
| `route53domains:ListDomains` | 도메인 목록 조회 불가 |

`sts:GetFederationToken`도 거부 대상이지만 오류 메시지에 거부의 원인이 SCP로 나오지 않는다.

`sts:AssumeRole`은 거부되지 않는다.

OIDC의 `AssumeRoleWithWebIdentity`는 호출 주체가 계정 밖이라 SCP 평가를 받지 않고, assume이 끝난 CI 역할 세션부터는 SCP가 그대로 적용된다.

## DNS

| 대상 | 관리 주체 |
| --- | --- |
| 네임서버와 DNS 레코드 전체 | Cloudflare |
| ACM 인증서 | `joynnovate-infra` |
| CloudFront 배포 | `buddybird-app` |

Route 53 hosted zone은 만들지 않는다.

CloudFront용 ACM 인증서는 us-east-1에서 발급한다.

사람이 Cloudflare에 등록해야 하는 레코드는 두 가지다.

- ACM 검증 CNAME
  - 등록 전까지 인증서 검증이 끝나지 않아 적용이 멈춤
- CloudFront 배포를 가리키는 레코드
  - 루트 도메인에는 CNAME flattening으로 CloudFront를 직접 지정
  - Cloudflare 프록시를 끈 상태로 등록

## 용어

| 용어 | 뜻 |
| --- | --- |
| 리스 | 샌드박스가 계정을 빌려주는 기간 |
| AWS Nuke | 계정 안의 리소스를 일괄 삭제하는 도구 |
| OU | 조직 안에서 계정을 묶는 단위 |
| SCP | 조직이 멤버 계정에 강제하는 거부 정책으로 계정 안에서는 해제 불가 |
| state | Pulumi가 생성한 리소스 목록을 기록한 파일 |
| immutable sub | 조직과 저장소를 이름 대신 숫자 ID로 가리키는 `sub` 클레임 형식 |
| gateway endpoint | NAT Gateway 없이 VPC에서 S3로 통신하게 하는 경로 |
| RBAC | 역할 기반 접근 제어, 사용자에게 역할을 부여해 권한을 정하는 방식 |
| OAC | CloudFront만 S3 버킷을 읽게 하는 접근 제어 설정 |
| CNAME flattening | CNAME을 둘 수 없는 루트 도메인에서 Cloudflare가 CNAME을 미리 풀어 IP로 응답하는 기능 |
