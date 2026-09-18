# joynnovate-bootstrap

Pulumi state 버킷, KMS 키, CI 역할 구성

## 파일 구성

| 파일 | 역할 |
|---|---|
| `__main__.py` | 상수, 컴포넌트 조립, 출력값 |
| `state.py` | `StateBucket` 컴포넌트 |
| `secrets_key.py` | `SecretsKey` 컴포넌트 |
| `ci.py` | `CiRoles` 컴포넌트 |
| `moved.py` | 컴포넌트 이전에 사용하는 aliases 헬퍼, 이전 완료 후 삭제 |

## 리소스 구성

모든 리소스는 컴포넌트 아래에 있습니다.
컴포넌트는 `(name, args, opts)` 생성자와 `@dataclass` Args를 사용하고 자식 논리 이름에 컴포넌트 이름을 접두어로 붙입니다.

| 컴포넌트 | 이름 | 리소스 |
|---|---|---|
| `StateBucket` | `state` | state 버킷, 버저닝, 암호화, public access block, 소유권 설정, 라이프사이클, TLS 전용 정책 |
| `SecretsKey` | `secrets` | KMS 키, 별칭 |
| `CiRoles` | `ci` | OIDC provider, CI 역할 2개와 정책 |

## 생성 리소스

| 리소스 | 식별자 |
|---|---|
| S3 버킷 | `jn-state-198252712951-ap-northeast-2-an` |
| KMS 키 | `alias/jn-pulumi-secrets` |
| OIDC provider | `token.actions.githubusercontent.com` |
| IAM 역할 | `jn-ci-preview` |
| IAM 역할 | `jn-ci-pulumi` |

### state 버킷

| 설정 | 값 |
|---|---|
| 버저닝 | 활성화 |
| 암호화 | AES256 |
| public access | 모든 항목 차단 |
| 미완료 멀티파트 업로드 | 7일 후 중단 |
| 이전 버전 state | 90일 후 삭제 |
| 버킷 정책 | TLS 필수 |

### KMS 키

| 설정 | 값 |
|---|---|
| 자동 키 교체 | 활성화 |
| 삭제 대기 기간 | 7일 |

### 삭제 보호

| 대상 | 설정 | 이유 |
|---|---|---|
| state 버킷 | `protect=True` | 한쪽만 보호하면 state 파일과 복호화 키 중 하나만 남아서 복구 불가 |
| KMS 키 | `protect=True` | 동일 |

## CI 역할

| 역할 | assume 주체 | 관리형 정책 |
|---|---|---|
| `jn-ci-preview` | PR 워크플로 | `ReadOnlyAccess` |
| `jn-ci-pulumi` | `prod` environment 워크플로 | `PowerUserAccess` |

### 추가 인라인 권한

| 역할 | 권한 |
|---|---|
| `jn-ci-preview` | `.pulumi/locks/` 쓰기, KMS 복호화 |
| `jn-ci-pulumi` | state 버킷 읽기와 쓰기, KMS 암복호화, 서비스 역할 관리 |

### `jn-ci-pulumi` 거부 정책

| 거부 대상 |
|---|
| IAM 사용자 생성 |
| 액세스 키 생성 |
| OIDC provider 생성, 변경, 삭제 |
| `jn-ci-*` 역할 변경, 삭제 |
| state 버킷 삭제 |
| KMS 키 삭제 예약, 비활성화 |

### 앱 배포 역할

| 항목 | 값 |
|---|---|
| 생성 위치 | 이미지 배포 역할은 `buddybird-shared`, 랜딩 배포 역할은 `buddybird-app` |
| 이름 접두사 | `jn-ci-*` 이외 사용 |

### 신뢰 정책

OIDC provider `token.actions.githubusercontent.com`을 신뢰하고 `sub`를 `StringEquals`로 일치시킵니다.

| 역할 | `sub` 컨텍스트 |
|---|---|
| `jn-ci-preview` | `pull_request` |
| `jn-ci-pulumi` | `environment:prod` |

## 최초 구축

### 1. 로컬 백엔드로 적용

```bash
cd bootstrap
pulumi login file://~
pulumi stack init prod
pulumi up
```

passphrase로 secret을 암호화하기 때문에 `PULUMI_CONFIG_PASSPHRASE`가 필요합니다.

### 2. S3 백엔드로 이관

```bash
pulumi login s3://jn-state-198252712951-ap-northeast-2-an?region=ap-northeast-2
pulumi stack migrate file://~ prod \
  --secrets-provider "awskms://alias/jn-pulumi-secrets?region=ap-northeast-2"
```

이관 후 `~/.pulumi/stacks/joynnovate-bootstrap/prod.json`은 이전 사본이므로 삭제합니다.

### 3. 나머지 스택 생성

각 프로젝트 디렉터리에서 실행합니다.

```bash
pulumi stack init prod \
  --secrets-provider "awskms://alias/jn-pulumi-secrets?region=ap-northeast-2"
```

## 출력값

| 출력값 | 사용처 |
|---|---|
| `state_bucket_name` | 백엔드 URL 확인 |
| `state_bucket_arn` | `jn-ci-pulumi` 권한 범위 |
| `secrets_key_arn` | `jn-ci-pulumi` 권한 범위 |
| `secrets_key_alias` | secrets provider URL 확인 |
| `region` | 백엔드, secrets provider URL 리전 |
| `ci_preview_role_arn` | preview 워크플로 `role-to-assume` |
| `ci_pulumi_role_arn` | apply 워크플로 `role-to-assume` |
