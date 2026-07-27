# joynnovate-bootstrap

CI가 동작하는 데 필요한 계정 기반 자원을 만드는 프로젝트다.

state를 저장할 S3 버킷과 스택 secret을 암호화할 KMS 키, GitHub Actions가 assume할 역할을 만든다.

사람이 로컬에서 실행해야 한다.

## 생성 리소스

| 리소스 | 식별자 |
| --- | --- |
| S3 버킷 | `jn-state-198252712951-ap-northeast-2-an` |
| KMS 키 | `alias/jn-pulumi-secrets` |
| GitHub OIDC provider | `token.actions.githubusercontent.com` |
| IAM 역할 | `jn-ci-preview` |
| IAM 역할 | `jn-ci-pulumi` |

### S3 버킷

state 버킷에는 다음 설정을 적용한다.

| 설정 | 값 |
| --- | --- |
| 버저닝 | Enabled |
| 서버 측 암호화 | AES256 |
| public access block | 네 항목 모두 차단 |
| ownership controls | BucketOwnerEnforced |
| 미완료 멀티파트 업로드 | 시작 후 7일에 중단 |
| 이전 버전 state | 90일 뒤 삭제 |
| 버킷 정책 | `aws:SecureTransport`가 false인 요청을 거부 |

버킷에는 `protect=True`를 걸어 `pulumi destroy`로 삭제되지 않게 한다.

정말 삭제해야 하면 `protect`를 제거하고 적용한 뒤 destroy를 실행한다.

### KMS 키

| 설정 | 값 |
| --- | --- |
| 자동 키 교체 | 활성화 |
| 삭제 대기 기간 | 7일 |

## state 버킷 이름

버킷은 `account-regional` namespace로 만들기 때문에 이름 형식이 정해져 있다.

```
<접두사>-<계정 ID>-<리전>-an
jn-state-198252712951-ap-northeast-2-an
```

접미사 `-198252712951-ap-northeast-2-an`은 31자이고, 버킷 이름의 63자 제한은 이 접미사까지 함께 카운트한다.

접두사에는 32자까지 사용할 수 있다.

## CI 역할

| 역할 | assume 주체 | 허용 작업 |
| --- | --- | --- |
| `jn-ci-preview` | PR에서 도는 워크플로 | 계정 전체 읽기, `.pulumi/locks/` 쓰기, KMS 키로 복호화 |
| `jn-ci-pulumi` | `prod` environment를 참조하는 워크플로 | `joynnovate-infra` 적용, state 버킷 읽기와 쓰기, KMS 키로 암복호화 |

`jn-ci-preview`에는 `ReadOnlyAccess`를 붙인다.

`jn-ci-pulumi`에는 `PowerUserAccess`와 IAM 인라인 정책을 붙이고, 다음 작업은 거부한다.

- IAM 사용자와 액세스 키 생성
- OIDC provider의 생성과 변경, 삭제
- `jn-ci-*` 역할의 변경과 삭제
- state 버킷 삭제
- KMS 키의 삭제 예약과 비활성화

두 역할 모두 신뢰 정책에서 GitHub OIDC provider를 신뢰하고, `sub` 조건을 `StringEquals`로 일치시킨다.

| 역할 | `sub` |
| --- | --- |
| `jn-ci-preview` | `repo:<접두사>:pull_request` |
| `jn-ci-pulumi` | `repo:<접두사>:environment:prod` |

`sub`에는 immutable sub 형식을 사용한다.

```
repo:<조직>@<owner_id>/<저장소>@<repo_id>
```

조직과 저장소의 숫자 ID는 GitHub API로 조회한다.

```bash
gh api /repos/<조직>/<저장소> --jq '[.owner.id, .id]'
```

immutable 형식은 저장소 Settings의 Actions에서 켠다.
현재 설정은 다음 명령으로 확인한다.

```bash
gh api /repos/<조직>/<저장소>/actions/oidc/customization/sub
```

AWS가 자체 신뢰 루트 CA 목록으로 GitHub 인증서를 검증하므로 `thumbprint_list`는 지정하지 않는다.

## 최초 구축 절차

계정을 다시 발급받아 재구축할 때도 같은 절차를 적용한다.

state 버킷 자체를 이 프로젝트가 만들기 때문에 첫 적용에는 S3 백엔드를 사용할 수 없다.

로컬 파일 백엔드에서 한 번 적용한 뒤 스택을 S3로 옮긴다.

로컬 백엔드에서 스택을 만들고 적용한다.

```bash
cd bootstrap
pulumi login file://~
pulumi stack init prod
pulumi up
```

이 단계의 스택은 passphrase로 secret을 암호화하므로 `PULUMI_CONFIG_PASSPHRASE`가 필요하다.

버킷이 생기면 S3 백엔드로 로그인하고 스택을 옮긴다.

```bash
pulumi login s3://jn-state-198252712951-ap-northeast-2-an?region=ap-northeast-2
pulumi stack migrate file://~ prod \
  --secrets-provider "awskms://alias/jn-pulumi-secrets?region=ap-northeast-2"
```

`pulumi stack migrate`는 옮기는 과정에서 secret을 KMS 키로 다시 암호화한다.

이 명령이 끝나면 passphrase는 더 이상 필요하지 않다.

`Pulumi.prod.yaml`이 KMS secrets provider로 갱신되고, 이전 내용은 `Pulumi.prod.yaml.bak.*`로 남는다.

로컬 백엔드에 남은 `~/.pulumi/stacks/joynnovate-bootstrap/prod.json`은 옛 사본이므로 삭제한다.

`joynnovate-infra`의 스택은 사람이 로컬에서 한 번 만든다.

```bash
cd infra
pulumi stack init prod \
  --secrets-provider "awskms://alias/jn-pulumi-secrets?region=ap-northeast-2"
```

이후 적용은 GitHub Actions가 한다.

## 출력값

| 출력값 | 사용처 |
| --- | --- |
| `state_bucket_name` | 백엔드 URL 확인 |
| `state_bucket_arn` | `jn-ci-pulumi` 역할의 권한 범위 |
| `secrets_key_arn` | `jn-ci-pulumi` 역할의 권한 범위 |
| `secrets_key_alias` | secrets provider URL 확인 |
| `region` | 백엔드 URL과 secrets provider URL의 리전 |
| `ci_preview_role_arn` | preview 워크플로의 `role-to-assume` |
| `ci_pulumi_role_arn` | apply 워크플로의 `role-to-assume` |

`joynnovate-infra`와 `buddybird-app`은 이 프로젝트를 StackReference로 참조하지 않는다.

백엔드 URL과 secrets provider URL은 각 프로젝트의 설정 파일에 직접 적는다.
