# buddybird-shared

buddybird의 dev와 prod 환경이 함께 사용하는 ECR 저장소, 이미지 배포 역할, RDS 서브넷 그룹 구성

| 항목 | 값 |
|---|---|
| StackReference | `organization/joynnovate-infra/prod` |
| 스택 | `prod` |

## 파일 구성

| 파일 | 역할 |
|---|---|
| `__main__.py` | 상수, 컴포넌트 조립, 출력값 |
| `deploy.py` | `ImageDelivery` 컴포넌트, ECR 저장소와 라이프사이클 정책을 만드는 `repository` 함수 |
| `data.py` | `DbNetwork` 컴포넌트 |
| `oidc.py` | GitHub OIDC 신뢰 정책 |
| `ota.py` | `Ota` 컴포넌트 |
| `ota/` | hot-updater OTA 서버 파일 |

## 리소스 구성

모든 리소스는 컴포넌트 아래에 있습니다.
컴포넌트는 `(name, args, opts)` 생성자와 `@dataclass` Args를 사용하고 자식 논리 이름에 컴포넌트 이름을 접두어로 붙입니다.

| 컴포넌트 | 이름 | 리소스 |
|---|---|---|
| `ImageDelivery` | `api`, `backoffice-frontend`, `mbti-web`, `audio-ai` | ECR 저장소, 라이프사이클 정책, 배포 역할과 정책 |
| `DbNetwork` | `db-network` | RDS 서브넷 그룹 |
| `Ota` | `ota` | R2 bucket, D1 데이터베이스, Worker, Worker Custom Domain |

`audio-ai`는 배포 역할 하나에 ECR 저장소 `jn-buddybird-parrot-detection`, `jn-buddybird-mimic-judgment`를 둡니다.
이전 함수가 사용하던 `jn-buddybird-audio-ai` 저장소는 `repository` 함수로 `audio-ai` 컴포넌트 아래에 따로 만듭니다.
ECR 저장소의 설정과 배포 역할의 신뢰 정책, 권한은 `buddybird-app.md`의 서비스별 절에 있습니다.

## 환경 공유 기준

| 리소스 | 공유하는 이유 |
|---|---|
| ECR 저장소 | 환경을 이미지 태그로 구분 |
| 이미지 배포 역할 | 서비스 레포지토리마다 역할 1개를 사용하고 앱 레포지토리의 GitHub Actions가 이 역할로 dev와 prod에 배포 |
| RDS 서브넷 그룹 | dev와 prod의 RDS가 같은 private 서브넷 사용 |

배포 역할의 권한은 환경별 리소스의 ARN을 참조하지 않고 `jn-buddybird-<서비스>-*` 이름 패턴을 사용합니다.
그래서 `buddybird-shared`는 `buddybird-app`의 출력값을 읽지 않습니다.

## 출력값

| 출력값 | 사용처 |
|---|---|
| `api_repository_url` | api task definition의 이미지 |
| `backoffice_frontend_repository_url` | backoffice frontend task definition의 이미지 |
| `mbti_web_repository_url` | mbti web task definition의 이미지 |
| `parrot_detection_repository_url` | 앵무새 소리 판별 Lambda 함수의 이미지 |
| `mimic_judgment_repository_url` | 모사 판정 Lambda 함수의 이미지 |
| `db_subnet_group_name` | RDS 인스턴스 |
| `api_deploy_role_arn` | `buddybird-api` 레포지토리의 GitHub Actions |
| `backoffice_frontend_deploy_role_arn` | `buddybird-backoffice-frontend` 레포지토리의 GitHub Actions |
| `mbti_web_deploy_role_arn` | `buddybird-mbti-web` 레포지토리의 GitHub Actions |
| `audio_ai_deploy_role_arn` | `buddybird-ai-api` 레포지토리의 GitHub Actions |
| `ota_account_id` | `ota/wrangler.json`, `buddybird-mobile` 레포지토리의 `hot-updater.config.ts` |
| `ota_d1_database_id` | `ota/wrangler.json`, `buddybird-mobile` 레포지토리의 `hot-updater.config.ts` |
| `ota_d1_database_name` | `ota/wrangler.json` |
| `ota_r2_bucket_name` | `ota/wrangler.json` |

## ota

`buddybird-mobile` 앱이 hot-updater로 번들을 내려받는 OTA 서버입니다.
서버 주소는 `https://ota.buddybird.xyz`입니다.

### 리소스

| 리소스 | 이름 | 내용 |
|---|---|---|
| R2 bucket | `jn-buddybird-ota` | 번들 파일 |
| D1 데이터베이스 | `jn-buddybird-ota` | 번들 목록과 클라이언트 API 키 |
| Worker | `jn-buddybird-ota` | `ota/index.js` 실행 |
| Worker Custom Domain | `ota.buddybird.xyz` | Worker로 요청 전달 |

Worker는 cache와 observability를 사용합니다.
모든 리소스는 `buddybird.xyz` zone이 속한 Cloudflare 계정에 있고, 계정 ID는 zone에서 조회합니다.

| Worker binding | 종류 | 값 |
|---|---|---|
| `DB` | D1 | `jn-buddybird-ota` 데이터베이스 |
| `BUCKET` | R2 bucket | `jn-buddybird-ota` bucket |
| `ACCOUNT_ID` | 변수 | Cloudflare 계정 ID |
| `BUCKET_NAME` | 변수 | bucket 이름 |
| `R2_ACCESS_KEY_ID` | secret | 스택 config `otaR2AccessKeyId` |
| `R2_SECRET_ACCESS_KEY` | secret | 스택 config `otaR2SecretAccessKey` |

Worker는 R2 키로 번들 다운로드 URL에 서명합니다.
Worker와 Custom Domain은 두 R2 키가 모두 스택 config에 있을 때만 만듭니다.
그래서 첫 적용은 R2 bucket과 D1만 만들고, 수동 단계를 마친 뒤 다시 적용하면 Pulumi가 Worker와 Custom Domain을 생성합니다.

### 서버 파일

`ota/`의 파일은 `hot-updater@1.1.0 infra scaffold --provider cloudflare`의 출력입니다.

| 파일 | scaffold 출력 | 변경 |
|---|---|---|
| `ota/index.js` | `worker/dist/index.js` | X |
| `ota/migrations/` | `worker/migrations/` | X |
| `ota/manifest.json` | `manifest.json` | X |
| `ota/wrangler.json` | `worker/wrangler.json` | O |

`wrangler.json`은 `main`을 `./index.js`로, `name`을 `jn-buddybird-ota`로 변경했습니다.
계정 ID, D1 ID와 이름, bucket 이름은 수동 단계에서 스택 출력값으로 기입합니다.

hot-updater를 올릴 때 다음 순서로 갱신합니다.

1. `buddybird-mobile`의 hot-updater와 같은 버전으로 `npx --yes hot-updater@<버전> infra scaffold --provider cloudflare --output <폴더> --json` 실행
2. 위 표의 대응대로 `ota/` 파일 교체
3. 교체한 `wrangler.json`에 기존 값 복원
   - `main`
   - `name`
   - 계정 ID
   - D1 ID
   - D1 이름
   - bucket 이름
4. 마이그레이션 명령의 wrangler 버전을 새 scaffold의 `worker/package.json`에 있는 버전으로 변경
5. 새 scaffold의 `upgrades/README.md`와 버전별 파일을 `ota/manifest.json`의 `serverVersion`, `infrastructureGeneration`과 비교해 안내를 따름
6. `buddybird-shared up`으로 스택 다시 적용

### 스택 config

| 키 | 내용 | 필수 |
|---|---|---|
| `cloudflare:apiToken` | Cloudflare provider의 API 토큰, secret | O |
| `otaR2AccessKeyId` | Worker용 R2 API 토큰의 Access Key ID, secret | X |
| `otaR2SecretAccessKey` | Worker용 R2 API 토큰의 Secret Access Key, secret | X |

`cloudflare:apiToken`은 `Edit Cloudflare Workers` 템플릿에 `D1 Edit`, `Workers R2 Storage Edit` 권한을 추가한 토큰입니다.
토큰의 범위는 `buddybird.xyz` zone이 속한 계정과 zone으로 제한합니다.

### 수동 단계

1. 첫 적용 뒤 `ota/wrangler.json`에 출력값 기입
   - `ota_account_id`
   - `ota_d1_database_id`
   - `ota_d1_database_name`
   - `ota_r2_bucket_name`
2. `buddybird-shared/ota`에서 D1 마이그레이션 적용

```bash
npx --yes wrangler@4.99.0 d1 migrations apply jn-buddybird-ota --remote
```

3. Cloudflare 대시보드에서 `jn-buddybird-ota` bucket 전용 R2 API 토큰 두 개 생성

| 용도 | 권한 | 등록 위치 |
|---|---|---|
| Worker | Object Read | 스택 config `otaR2AccessKeyId`, `otaR2SecretAccessKey` |
| 번들 배포 | Object Read & Write | `buddybird-mobile` 레포지토리 secret `HOT_UPDATER_CLOUDFLARE_R2_ACCESS_KEY_ID`, `HOT_UPDATER_CLOUDFLARE_R2_SECRET_ACCESS_KEY` |

4. `buddybird-shared up`으로 리소스 생성
   - Worker
   - Custom Domain
5. `buddybird-mobile`에서 `.env.hotupdater`에 `D1 Edit` 권한 API 토큰을 `HOT_UPDATER_CLOUDFLARE_API_TOKEN`으로 넣고 `yarn hot-updater api-key create`로 클라이언트 API 키 생성
6. 클라이언트 API 키를 EAS 환경 변수 `EXPO_PUBLIC_HOT_UPDATER_API_KEY`의 `preview`, `production` 환경에 등록
