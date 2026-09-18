# aws-infra

buddybird 서비스의 Amazon Web Services(AWS) 인프라를 Pulumi로 관리한다.

| 항목 | 값 |
| --- | --- |
| 리전 | ap-northeast-2 |
| 계정 | - 198252712951<br>- Innovation Sandbox로 임대한 단일 계정 |
| 도메인 | buddybird.xyz |
| 네임서버 | Cloudflare |
| Python | 3.14 이상 |
| 패키지 관리 | uv |
| Pulumi | 3.254.0 이상 |
| Pulumi provider | - pulumi-aws 7.x<br>- pulumi-cloudflare 6.x |

## 프로젝트

| 프로젝트 | 디렉터리 | 만드는 것 | 적용 주체 |
| --- | --- | --- | --- |
| `joynnovate-bootstrap` | `bootstrap/` | - state 버킷<br>- Key Management Service(KMS) 키<br>- OpenID Connect(OIDC) provider<br>- 지속적 통합(Continuous Integration, CI) 역할 | 사람 |
| `joynnovate-infra` | `infra/` | - Virtual Private Cloud(VPC)<br>- Elastic Container Service(ECS) 클러스터<br>- Application Load Balancer(ALB)<br>- AWS Certificate Manager(ACM) 인증서<br>- 로그 버킷<br>- 예산 알림 | GitHub Actions |
| `buddybird-shared` | `buddybird-shared/` | - Elastic Container Registry(ECR)<br>- 이미지 배포 역할<br>- Relational Database Service(RDS) 서브넷 그룹 | GitHub Actions |
| `buddybird-app` | `buddybird-app/` | - ECS 서비스<br>- RDS<br>- Simple Storage Service(S3) 버킷<br>- CloudFront<br>- 랜딩 배포 역할 | GitHub Actions |

설계 문서는 `docs/` 아래에 프로젝트 이름으로 있다.

`buddybird-app`은 환경마다 스택을 두어 `dev`와 `prod` 스택을 사용한다.
나머지 프로젝트는 환경이 공유하는 자원을 만들기 때문에 `prod` 스택 하나를 사용한다.

`buddybird-shared`는 `joynnovate-infra`의 출력값을, `buddybird-app`은 `joynnovate-infra`와 `buddybird-shared`의 출력값을 StackReference로 읽는다.
읽히는 프로젝트를 먼저 적용한다.

## 소유 규칙

| 자원 | 소유 프로젝트 |
| --- | --- |
| 여러 제품이 함께 사용하는 것 | `joynnovate-infra` |
| buddybird 전용이고 환경에 속하는 것 | `buddybird-app` |
| buddybird 전용이고 환경이 공유하는 것 | `buddybird-shared` |
| 인프라를 적용하는 역할 | `joynnovate-bootstrap` |
| 이미지를 배포하는 역할 | `buddybird-shared` |
| 랜딩을 배포하는 역할 | `buddybird-app` |

랜딩 배포 역할은 랜딩 버킷과 CloudFront의 ARN을 직접 참조하기 때문에 `buddybird-app`에 둔다.

`buddybird.xyz`를 경로로 나누어 사용하기 때문에 호스트명 레코드도 `buddybird-app`이 소유한다.

| 경로 | 서비스 |
| --- | --- |
| `buddybird.xyz/` | 랜딩 사이트 |
| `buddybird.xyz/api/*` | buddybird-api |

## state

- 백엔드: `s3://jn-state-198252712951-ap-northeast-2-an?region=ap-northeast-2`
- 스택 명: `organization/<프로젝트>/<스택>`

모든 프로젝트가 같은 백엔드 URL을 사용한다.
다르게 지정하면 StackReference가 동작하지 않는다.

자체 관리 백엔드이기 때문에 조직 자리는 항상 `organization` 상수다.

## secrets

Pulumi가 스택 secret을 KMS 키로 암호화한다.

- secrets provider: `awskms://alias/jn-pulumi-secrets?region=ap-northeast-2`

| 스택 secret | 보관 스택 |
| --- | --- |
| `cloudflare:apiToken` | - `joynnovate-infra`<br>- `buddybird-app` |
| `authAccessTokenKey` | `buddybird-app` |
| `authRefreshTokenKey` | `buddybird-app` |
| `backofficePassword` | `buddybird-app` |
| `readonlyDbPassword` | `buddybird-app` |

`buddybird-app`의 `dev`와 `prod` 스택은 스택을 나눌 때 값을 복사했기 때문에 현재 같은 secret 값을 사용한다.

`Pulumi.<스택>.yaml`에는 다음 항목만 작성한다.

- `aws:region`
- `aws:defaultTags`
- secrets provider
- 스택 secret
- 스택마다 다른 값

도메인, 이름 접두사, 예산 금액, VPC Classless Inter-Domain Routing(CIDR)은 각 프로젝트의 Python 상수로 정의한다.
스택마다 다른 값은 `buddybird-app`의 서브도메인, 리스너 규칙 우선순위, 스택에 포함할 서비스다.

## 인증

| 실행 위치 | 방식 |
| --- | --- |
| 로컬 | 샌드박스 Identity Center 포털로 Single Sign-On(SSO) 로그인 |
| GitHub Actions | OIDC로 역할을 assume |

### immutable sub

신뢰 정책의 `sub`는 immutable sub 형식을 사용한다.

```
repo:<조직>@<owner_id>/<저장소>@<repo_id>:<컨텍스트>
```

저장소마다 immutable subject를 켜야 이 형식을 발급한다.

```bash
gh api -X PUT /repos/<조직>/<저장소>/actions/oidc/customization/sub \
  -F use_default=true -F use_immutable_subject=true
```

숫자 ID는 GitHub API로 조회한다.

```bash
gh api /repos/<조직>/<저장소> --jq '[.owner.id, .id]'
```

## 적용

적용 순서는 `bootstrap`, `infra`, `buddybird-shared`, `buddybird-app`이다.

| 시점 | 동작 |
| --- | --- |
| Pull Request(PR) | `pulumi preview` 결과를 PR 코멘트로 게시 |
| Actions 탭에서 수동 실행 | `pulumi up --refresh` 실행 |

`buddybird-app`은 PR에서 `dev`와 `prod` 스택을 각각 preview하고, 수동 실행할 때 적용할 스택을 선택한다.
`dev` 스택을 적용할 때도 GitHub environment는 `prod`를 사용한다.
CI 역할 `jn-ci-pulumi`의 신뢰 정책이 `environment:prod` 하나만 허용하기 때문이다.

`--refresh`를 생략할 수 없다.
`buddybird-app`이 ECS 서비스의 `taskDefinition`을 `ignoreChanges`로 제외하기 때문이다.
refresh 없이 적용하면 Pulumi가 state에 남은 이전 revision을 다시 전송해 앱 배포가 되돌아간다.

`prod` environment에 required reviewer를 설정할 수 없다.
조직이 free 플랜이고 저장소가 private이기 때문에 environment protection rule을 사용할 수 없다.
사람이 Actions 탭에서 직접 실행하는 것이 승인을 대신한다.

## 샌드박스 제약

이 계정은 상위 조직의 멤버 계정이다.
조직이 Organizational Unit(OU)에 Service Control Policy(SCP)를 적용한다.

- 리스 만료 시 AWS Nuke가 리소스를 전부 삭제
  - RDS 데이터, S3 객체, state 파일이 함께 삭제됨
  - 모든 프로젝트를 처음부터 다시 적용해야 함
  - 계정 밖으로 백업하는 경로 없음
- 예산 한도 도달 시 리소스 생성 차단과 실행 중인 리소스 정지
  - 샌드박스 한도보다 낮은 금액으로 AWS Budgets 알림을 설정
- 하위 계정 생성 불가
  - 여러 환경이 한 계정에 공존하기 때문에 리소스 이름으로 환경을 구분

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

## DNS

Domain Name System(DNS) 레코드의 관리 주체는 다음과 같다.

| 대상 | 관리 주체 |
| --- | --- |
| ACM 검증 Canonical Name(CNAME) | `joynnovate-infra` |
| 서비스 호스트명 CNAME | `buddybird-app` |

모든 레코드에서 Cloudflare 프록시를 끈다.
프록시를 켜면 문제가 두 가지 생긴다.

- ACM이 검증 값을 읽지 못함
- ALB가 클라이언트 IP를 확인하지 못함

루트 도메인에도 CNAME을 사용한다.
Cloudflare의 CNAME flattening이 IP로 응답한다.

## 용어

| 용어 | 뜻 |
| --- | --- |
| 리스 | 샌드박스가 계정을 빌려주는 기간 |
| AWS Nuke | 계정 안의 리소스를 일괄 삭제하는 도구 |
| SCP | - 조직이 멤버 계정에 강제하는 거부 정책<br>- 계정 안에서는 해제 불가 |
| state | Pulumi가 생성한 리소스 목록을 기록한 파일 |
| StackReference | 다른 스택의 출력값을 읽는 Pulumi 리소스 |
| immutable sub | 조직과 저장소를 이름 대신 숫자 ID로 가리키는 `sub` 클레임 형식 |
| gateway endpoint | NAT Gateway 없이 VPC에서 S3로 통신하는 경로 |
| OAC | Origin Access Control, CloudFront만 S3 버킷을 읽도록 제한하는 접근 제어 설정 |
| CNAME flattening | CNAME을 사용할 수 없는 루트 도메인에서 Cloudflare가 CNAME을 미리 해석해 IP로 응답하는 기능 |
