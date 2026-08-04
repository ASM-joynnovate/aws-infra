# joynnovate-bootstrap

Pulumi가 동작하는 데 필요한 계정 기반 자원을 만든다.

| 파일 | 담당 |
| --- | --- |
| `__main__.py` | - state 버킷<br>- Key Management Service(KMS) 키<br>- 출력값 |
| `ci.py` | - `CiRoles` 컴포넌트<br>- OpenID Connect(OIDC) provider<br>- 지속적 통합(Continuous Integration, CI) 역할 |

## 생성 리소스

| 리소스 | 식별자 |
| --- | --- |
| Simple Storage Service(S3) 버킷 | `jn-state-198252712951-ap-northeast-2-an` |
| KMS 키 | `alias/jn-pulumi-secrets` |
| OIDC provider | `token.actions.githubusercontent.com` |
| Identity and Access Management(IAM) 역할 | `jn-ci-preview` |
| IAM 역할 | `jn-ci-pulumi` |

### state 버킷

| 설정 | 값 |
| --- | --- |
| 버저닝 | Enabled |
| 서버 측 암호화 | AES256 |
| public access block | 모든 항목 차단 |
| ownership controls | BucketOwnerEnforced |
| 미완료 멀티파트 업로드 | 시작 후 7일에 중단 |
| 이전 버전 state | 90일 후 삭제 |
| 버킷 정책 | `aws:SecureTransport`가 false인 요청 거부 |

버킷 이름은 `account-regional` namespace 형식을 따른다.

```
<접두사>-<계정 ID>-<리전>-an
```

### KMS 키

| 설정 | 값 |
| --- | --- |
| 자동 키 교체 | 활성화 |
| 삭제 대기 기간 | 7일 |

### 삭제 보호

버킷과 KMS 키에 `protect=True`를 적용한다.
한쪽만 보호하면 state 파일과 복호화 키 가운데 하나만 남기 때문에 어느 스택도 복구할 수 없다.

삭제하려면 `protect`를 제거하고 적용한 후 destroy를 실행한다.

## CI 역할

| 역할 | assume 주체 | 관리형 정책 |
| --- | --- | --- |
| `jn-ci-preview` | Pull Request(PR) 워크플로 | `ReadOnlyAccess` |
| `jn-ci-pulumi` | `prod` environment 워크플로 | `PowerUserAccess` |

| 역할 | 인라인 정책으로 추가하는 권한 |
| --- | --- |
| `jn-ci-preview` | - `.pulumi/locks/` 쓰기<br>- KMS 복호화 |
| `jn-ci-pulumi` | - state 버킷 읽기와 쓰기<br>- KMS 암복호화<br>- 서비스 역할 관리 |

`jn-ci-pulumi`는 다음 작업을 거부한다.

- IAM 사용자 생성
- 액세스 키 생성
- OIDC provider의 생성, 변경, 삭제
- `jn-ci-*` 역할의 변경, 삭제
- state 버킷 삭제
- KMS 키의 삭제 예약
- KMS 키 비활성화

앱을 배포하는 역할은 `buddybird-app`이 만든다.
`jn-ci-pulumi`가 `jn-ci-*` 역할 변경을 거부하기 때문에 앱 배포 역할의 이름은 이 접두사를 사용하지 않는다.

### 신뢰 정책

모든 역할이 OIDC provider를 신뢰한다.
`sub`는 `StringEquals`로 일치시킨다.
`sub` 형식은 `README.md`에 있다.

| 역할 | `sub` 컨텍스트 |
| --- | --- |
| `jn-ci-preview` | `pull_request` |
| `jn-ci-pulumi` | `environment:prod` |

## 최초 구축

계정을 다시 발급받아 재구축할 때도 같은 절차를 적용한다.

이 프로젝트가 state 버킷을 만들기 때문에 첫 적용에는 S3 백엔드를 사용할 수 없다.

### 1. 로컬 백엔드로 적용

```bash
cd bootstrap
pulumi login file://~
pulumi stack init prod
pulumi up
```

이 단계는 passphrase로 secret을 암호화하기 때문에 `PULUMI_CONFIG_PASSPHRASE`가 필요하다.

### 2. S3 백엔드로 이관

```bash
pulumi login s3://jn-state-198252712951-ap-northeast-2-an?region=ap-northeast-2
pulumi stack migrate file://~ prod \
  --secrets-provider "awskms://alias/jn-pulumi-secrets?region=ap-northeast-2"
```

`stack migrate`가 secret을 KMS 키로 다시 암호화하기 때문에 이후 passphrase가 필요하지 않다.

로컬 백엔드에 남은 `~/.pulumi/stacks/joynnovate-bootstrap/prod.json`은 이전 사본이므로 삭제한다.

### 3. 나머지 스택 생성

각 프로젝트 디렉터리에서 한 번씩 실행한다.

```bash
pulumi stack init prod \
  --secrets-provider "awskms://alias/jn-pulumi-secrets?region=ap-northeast-2"
```

## 출력값

| 출력값 | 사용처 |
| --- | --- |
| `state_bucket_name` | 백엔드 URL 확인 |
| `state_bucket_arn` | `jn-ci-pulumi` 권한 범위 |
| `secrets_key_arn` | `jn-ci-pulumi` 권한 범위 |
| `secrets_key_alias` | secrets provider URL 확인 |
| `region` | - 백엔드 URL의 리전<br>- secrets provider URL의 리전 |
| `ci_preview_role_arn` | preview 워크플로의 `role-to-assume` |
| `ci_pulumi_role_arn` | apply 워크플로의 `role-to-assume` |
