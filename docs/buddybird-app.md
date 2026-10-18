# buddybird-app

buddybird 전용 RDS, ECS 서비스, Lambda 함수, CloudFront 구성

ECR 저장소, 이미지 배포 역할, RDS 서브넷 그룹은 `buddybird-shared` 프로젝트가 소유합니다.
이 문서는 서비스별로 구성돼 있어 `buddybird-shared`가 소유한 리소스도 해당 서비스 절에 함께 적습니다.

| 항목 | 값 |
|---|---|
| StackReference | `organization/joynnovate-infra/prod`, `organization/buddybird-shared/prod` |

## 파일 구성

| 파일 | 역할 |
|---|---|
| `__main__.py` | 상수, 환경별 설정, 컴포넌트 조립, 출력값 |
| `data.py` | `DataBucket`, `Database` 컴포넌트, 버킷 하드닝 |
| `service.py` | `Api`, `WebService`, `AudioAi` 컴포넌트, 로그 그룹과 실행 역할과 Fargate 서비스 헬퍼 |
| `edge.py` | `Landing`, `MbtiCdn` 컴포넌트 |
| `oidc.py` | GitHub OIDC 신뢰 정책 |
| `dns.py` | Cloudflare CNAME 레코드 |
| `schedule.py` | `NightlyStop` 컴포넌트 |
| `messaging.py` | `Messaging` 컴포넌트 |

## 리소스 구성

모든 리소스는 컴포넌트 아래에 있습니다.
컴포넌트는 `(name, args, opts)` 생성자와 `@dataclass` Args를 사용하고 자식 논리 이름에 컴포넌트 이름을 접두어로 붙입니다.
`Api`는 `DataBucket`과 `Database`를 자식 컴포넌트로 갖습니다.

| 컴포넌트 | 이름 | 리소스 |
|---|---|---|
컴포넌트 이름에는 스택 이름이 붙습니다.

| 컴포넌트 | 이름 | 스택 | 리소스 |
|---|---|---|---|
| `Api` | `api-<스택>` | `dev`, `prod` | 앱 시크릿, 실행 역할과 task 역할, 로그 그룹, task definition, 타깃 그룹, 리스너 규칙, ECS 서비스, consumer, rotation 재배포 Lambda, 랜딩이 없는 스택의 DNS |
| `DataBucket` | `api-<스택>-data` | `dev`, `prod` | 데이터 버킷과 하드닝, 버저닝, 라이프사이클, TLS 전용 정책, CORS |
| `DataBucket` | `api-dev-local-data` | `dev` | 로컬 개발용 데이터 버킷 |
| `Database` | `api-<스택>-database` | `dev`, `prod` | RDS 인스턴스, readonly 시크릿 |
| `WebService` | `backoffice-frontend-prod` | `prod` | 로그 그룹, 실행 역할, task definition, 타깃 그룹, 리스너 규칙, ECS 서비스, DNS |
| `WebService` | `mbti-web-prod` | `prod` | backoffice frontend와 같음 |
| `AudioAi` | `parrot-detection-<스택>`, `mimic-judgment-<스택>` | `audioAi`가 있는 스택 | 로그 그룹, 실행 역할과 정책, Lambda 함수, SQS 트리거 |
| `MbtiCdn` | `mbti-cdn-prod` | `prod` | 이미지 캐시 정책, CloudFront |
| `Messaging` | `messaging-<스택>` | `dev`, `prod` | SQS 큐와 DLQ, DLQ 알람, 알람 topic, 업로드 이벤트 rule, 1분 주기 스케줄 |
| `NightlyStop` | `nightly-stop-dev` | `dev` | EventBridge Scheduler 5개, DB 시작 실패 DLQ와 알람, 실행 역할과 정책 |
| `Landing` | `landing-prod` | `prod` | 랜딩 버킷과 하드닝, OAC, rewrite 함수, CloudFront, 버킷 정책, 배포 역할과 정책, DNS `root`와 `www` |

## 환경

환경마다 스택을 둡니다.
스택 이름이 환경 이름이고 코드는 `pulumi.get_stack()`으로 환경을 읽습니다.

| 스택 | api 호스트명 | backoffice frontend 호스트명 | mbti web 호스트명 | 랜딩 |
|---|---|---|---|---|
| `prod` | `buddybird.xyz` | `backoffice.buddybird.xyz` | `mbti.buddybird.xyz` | O |
| `dev` | `dev.buddybird.xyz` | X | X | X |

### dev 야간 정지

`nightlyStop`이 `true`인 스택은 EventBridge Scheduler가 한국 시간 기준으로 아래 작업을 실행합니다.

| 시각 | 스케줄 | 동작 |
|---|---|---|
| 03:00 | `jn-buddybird-dev-stop-service` | api 서비스 `desiredCount` 0 |
| 03:05 | `jn-buddybird-dev-stop-db` | RDS 정지 |
| 07:30 | `jn-buddybird-dev-start-db` | RDS 시작 |
| 07:45 | `jn-buddybird-dev-start-db-retry` | RDS 시작 재시도 |
| 08:00 | `jn-buddybird-dev-start-service` | api 서비스 `desiredCount` 1 |

Scheduler는 RDS가 반환한 클라이언트 오류를 재시도하지 않습니다.
07:30 시작이 실패하면 07:45 스케줄이 한 번 더 시작하고, 07:30 실패 내용은 DLQ `jn-buddybird-dev-nightly-stop-dlq`에 14일간 남습니다.
DLQ에 메시지가 들어오면 `jn-buddybird-dev-alarms` topic으로 팀 이메일을 발송합니다.
07:30 시작이 성공한 날에는 07:45 호출이 `InvalidDBInstanceState` 오류로 끝나며 DB 상태는 바뀌지 않습니다.

실행 역할은 `jn-buddybird-dev-nightly-stop`이고 해당 스택의 api 서비스, RDS 인스턴스, DLQ에만 권한이 있습니다.
03시부터 08시 사이에는 dev 배포의 마이그레이션 task와 dev 스택의 RDS 변경이 실패합니다.

### 스택 config

스택마다 다른 값은 `Pulumi.<스택>.yaml`에 둡니다.
도메인과 이름 접두사는 Python 상수입니다.

| 키 | 값 | 필수 |
|---|---|---|
| `api` | `subdomain`, `priority`, `capacity`. `subdomain`이 없으면 루트 도메인 | O |
| `backofficeFrontend` | `subdomain`, `priority`, `capacity`. 키가 있는 스택에만 backoffice frontend 생성 | X |
| `mbtiWeb` | `subdomain`, `priority`. 키가 있는 스택에만 mbti web과 MBTI CloudFront 생성 | X |
| `audioAi` | `maximumConcurrency`. 키가 있는 스택에만 앵무새 소리 판별과 모사 판정 Lambda 함수, SQS 트리거 생성 | X |
| `audioAiSentryDsn` | buddybird-audio-ai Sentry 프로젝트의 DSN. `audioAi`가 있는 스택에서 두 Lambda 함수의 환경 변수로 전달하는 secret | X |
| `landing` | `true`인 스택에만 랜딩 생성 | X |
| `localDataBucket` | `true`인 스택에 로컬 개발용 데이터 버킷 생성 | X |
| `dbDeletionProtection` | `true`이면 RDS 삭제 보호와 최종 스냅샷 사용 | X |
| `mbtiCdnEnabled` | `true`이면 mbti DNS를 MBTI CloudFront로 연결 | X |
| `nightlyStop` | `true`인 스택의 api 서비스와 RDS를 매일 03시에 정지하고 08시에 시작 | X |
| `consumerSeparate` | `true`이면 consumer를 별도 ECS 서비스로 생성. 없으면 api task의 두 번째 컨테이너로 실행 | X |
| `supabaseUrl`, `supabasePublishableKey`, `googleClientId`, `appleClientIds`, `appleTeamId`, `appleKeyId`, `ga4PropertyId`, `cloudflareTurnKeyId` | api와 consumer의 환경 변수 값 | O |
| `supabaseSecretKey`, `oauthCredentialsKey`, `googleClientSecret`, `applePrivateKey`, `kakaoAdminKey`, `firebaseServiceAccountJson`, `sentryDsn`, `sentryApiToken`, `cloudflareTurnApiToken` | 앱 시크릿에 저장하는 secret | O |

`capacity`는 ECS 서비스의 capacity provider 전략이고 기본값은 `on-demand`입니다.

| 값 | 전략 |
|---|---|
| `on-demand` | `FARGATE` |
| `spot` | `FARGATE_SPOT` |
| `on-demand-with-spot` | `FARGATE` base 1과 `FARGATE_SPOT` weight 1 |

데이터 버킷의 CORS origin은 api와 backoffice frontend의 호스트명에서 계산합니다.
backoffice frontend가 없는 스택은 그 자리에 `http://localhost:3000`을 사용하고 api의 `FRONTEND_CORS_ORIGIN`에도 같은 값을 넣습니다.
api의 DNS 레코드는 랜딩이 없는 스택에서만 만듭니다.
랜딩이 있는 스택에서는 랜딩 CloudFront가 루트 도메인을 소유하고 `/api/*`를 ALB로 전달합니다.

## 이름 규칙

### 환경별 이름

| 리소스 | 패턴 |
|---|---|
| api: RDS, ECS 서비스, 타깃 그룹, task definition, 앱 시크릿 | `jn-buddybird-api-<env>` |
| api: DB readonly 시크릿 | `jn-buddybird-api-<env>-readonly` |
| api: task role | `jn-buddybird-api-<env>-task` |
| api: execution role | `jn-buddybird-api-<env>-exec` |
| api: 로그 그룹 | `/ecs/jn-buddybird-api-<env>` |
| api: rotation Lambda, 역할, EventBridge 규칙 | `jn-buddybird-api-<env>-rotation` |
| consumer: ECS 서비스, task definition | `jn-buddybird-api-prod-consumer` |
| consumer: task role | `jn-buddybird-api-prod-consumer-task` |
| consumer: 로그 그룹 | `/ecs/jn-buddybird-api-prod-consumer` |
| 데이터 버킷 | `jn-buddybird-v1-data-<env>-<계정>-<리전>` |
| backoffice frontend: ECS 서비스, task definition | `jn-buddybird-backoffice-frontend-<env>` |
| backoffice frontend: 타깃 그룹 | `jn-buddybird-bo-fe-<env>` |
| backoffice frontend: execution role | `jn-buddybird-backoffice-frontend-<env>-exec` |
| backoffice frontend: 로그 그룹 | `/ecs/jn-buddybird-backoffice-frontend-<env>` |
| mbti web: ECS 서비스, task definition, 타깃 그룹 | `jn-buddybird-mbti-prod` |
| mbti web: execution role | `jn-buddybird-mbti-prod-exec` |
| mbti web: 로그 그룹 | `/ecs/jn-buddybird-mbti-prod` |
| 앵무새 소리 판별: Lambda 함수, 실행 역할 | `jn-buddybird-parrot-detection-<env>` |
| 앵무새 소리 판별: 로그 그룹 | `/aws/lambda/jn-buddybird-parrot-detection-<env>` |
| 모사 판정: Lambda 함수, 실행 역할 | `jn-buddybird-mimic-judgment-<env>` |
| 모사 판정: 로그 그룹 | `/aws/lambda/jn-buddybird-mimic-judgment-<env>` |

### 공통 이름

| 리소스 | 이름 | 소유 프로젝트 |
|---|---|---|
| api ECR 저장소 | `jn-buddybird-api` | `buddybird-shared` |
| api 배포 역할 | `jn-buddybird-api-deploy` | `buddybird-shared` |
| backoffice frontend ECR 저장소 | `jn-buddybird-backoffice-frontend` | `buddybird-shared` |
| backoffice frontend 배포 역할 | `jn-buddybird-backoffice-frontend-deploy` | `buddybird-shared` |
| mbti web ECR 저장소 | `jn-buddybird-mbti` | `buddybird-shared` |
| mbti web 배포 역할 | `jn-buddybird-mbti-deploy` | `buddybird-shared` |
| 앵무새 소리 판별 ECR 저장소 | `jn-buddybird-parrot-detection` | `buddybird-shared` |
| 모사 판정 ECR 저장소 | `jn-buddybird-mimic-judgment` | `buddybird-shared` |
| audio-ai 배포 역할 | `jn-buddybird-audio-ai-deploy` | `buddybird-shared` |
| RDS 서브넷 그룹 | `jn-buddybird-api` | `buddybird-shared` |
| 랜딩 버킷 | `jn-buddybird-site-<계정>-<리전>` | `buddybird-app` |
| 랜딩 배포 역할 | `jn-buddybird-site-deploy` | `buddybird-app` |

## api

### ECR 저장소

| 항목 | 값 |
|---|---|
| 이름 | `jn-buddybird-api` |
| 태그 변경 | IMMUTABLE |
| 스캔 | 푸시 시 |
| 태그 없는 이미지 | 7일 후 삭제 |
| 보관 | 최근 20개 |

### 배포 역할

#### 신뢰 정책

- 이름: `jn-buddybird-api-deploy`
- `buddybird-api` 레포지토리
  - `ref:refs/heads/main`
  - `ref:refs/heads/dev`
  - `environment:prod`

#### 권한

| 대상 | 액션 |
|---|---|
| `*` | `ecr:GetAuthorizationToken`, `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition` |
| ECR 저장소 | 레이어 업로드, `ecr:PutImage`, `ecr:DescribeImages` |
| ECS 서비스 `jn-buddybird-api-*` | `ecs:UpdateService`, `ecs:DescribeServices` |
| task definition `jn-buddybird-api-*` | `ecs:RunTask` |
| task | `ecs:DescribeTasks` (클러스터 ARN 조건) |
| `*-task`, `*-exec` 역할 | `iam:PassRole` (`ecs-tasks.amazonaws.com` 한정) |
| 로그 그룹 `/ecs/jn-buddybird-api-*` | `logs:GetLogEvents`, `logs:DescribeLogStreams` |

### RDS

| 항목           | 값 |
|----------------|---|
| engine         | PostgreSQL 17 |
| instance       | db.t4g.micro |
| storage        | gp3 20GB, 암호화 |
| 백업 보존      | 7일 |
| password       | `manage_master_user_password` |
| subnet         | private, 서브넷 그룹 환경 공유 |
| Pulumi 삭제 보호 | dev와 prod 모두 `protect=True` |
| RDS 삭제 보호 | prod만 `deletion_protection` |

### 비밀번호 rotation 재배포

| 항목 | 값 |
|---|---|
| 트리거 | RDS 관리 시크릿의 `AWSCURRENT` 라벨 이동 |
| EventBridge 규칙 | `Secret Label Updated`, `labelUpdated: AWSCURRENT` |
| Lambda | Python 3.14, `ecs:UpdateService` 호출 |
| 결과 | api 서비스 force new deployment |

### 앱 시크릿

| JSON 키 | 용도 |
|---|---|
| `backoffice_password` | backoffice 로그인 |
| `supabase_secret_key` | Supabase Auth 관리 API 호출 |
| `oauth_credentials_key` | 저장하는 OAuth 자격 증명의 Fernet 암호화 |
| `google_client_secret` | Google OAuth 토큰 요청 |
| `apple_private_key` | Apple 로그인의 client secret 서명 |
| `kakao_admin_key` | Kakao 관리 API 호출 |
| `firebase_service_account_json` | FCM 발송, GA4 조회 |
| `sentry_api_token` | Sentry API 조회 |
| `cloudflare_turn_api_token` | 펫캠 TURN 접속 정보 발급 |

### DB readonly 시크릿

| 항목 | 값 |
|---|---|
| 이름 | `jn-buddybird-api-<env>-readonly` |
| 형식 | `{"password": "..."}` |
| 용도 | readonly PostgreSQL 사용자 비밀번호 |

### 데이터 버킷

| 항목 | 값 |
|---|---|
| 암호화 | SSE-S3 |
| public access | 차단 |
| 버킷 정책 | TLS 필수 |
| 버저닝 | 활성화 |
| 이전 버전 | 30일 후 삭제 |
| 만료된 delete marker | 삭제 |
| 미완료 멀티파트 업로드 | 7일 후 삭제 |
| EventBridge 알림 | 활성화 |

#### 객체 만료

| 대상 | 만료 | 이전 버전 |
|---|---|---|
| `upload/` prefix | 1일 | 1일 후 삭제 |
| 태그 `retention=7d` | 7일 | 1일 후 삭제 |
| 태그 `retention=90d` | 90일 | 1일 후 삭제 |

`upload/`에는 변환 전 이미지 원본이 올라옵니다.
api는 세션 소리의 presigned URL에 `retention=7d` 태그를 서명합니다.
consumer는 앵무새 발성으로 판정된 소리의 태그를 `retention=90d`로 변경합니다.
응급 클립에는 `retention=90d`를 사용합니다.

#### CORS

허용 메서드는 `GET`과 `PUT`입니다.

| 환경 | 허용 출처 |
|---|---|
| dev | `https://dev.buddybird.xyz`, `http://localhost:3000` |
| prod | `https://buddybird.xyz`, `https://backoffice.buddybird.xyz` |
| local | `http://localhost:3000` |

### ECS 서비스

| 항목 | 값 |
|---|---|
| 아키텍처 | ARM64 Fargate |
| cpu | 256 |
| memory | prod 512, dev 1024 |
| 포트 | 8000 |
| 헬스체크 | `/api/healthz`, 10초 간격 |
| capacity provider | prod `on-demand-with-spot`, dev `spot` |
| task 수 | prod 2, dev 1 |
| 서브넷 | public, `assign_public_ip` |
| circuit breaker | 활성화, 실패 시 자동 롤백 |

### 환경 변수

| 변수 | 값 |
|---|---|
| `ENV` | `dev` 또는 `prod` |
| `DB_HOST` | RDS 주소 |
| `DB_NAME` | `buddybird` |
| `DB_USER` | `buddybird` |
| `S3_BUCKET_NAME` | 데이터 버킷 이름 |
| `FRONTEND_CORS_ORIGIN` | `["https://<backoffice frontend 호스트명>"]` |
| `SUPABASE_URL` | 스택 config `supabaseUrl` |
| `SUPABASE_PUBLISHABLE_KEY` | 스택 config `supabasePublishableKey` |
| `GOOGLE_CLIENT_ID` | 스택 config `googleClientId` |
| `APPLE_CLIENT_IDS` | 스택 config `appleClientIds`, JSON 배열 문자열 |
| `APPLE_TEAM_ID` | 스택 config `appleTeamId` |
| `APPLE_KEY_ID` | 스택 config `appleKeyId` |
| `GA4_PROPERTY_ID` | 스택 config `ga4PropertyId` |
| `CLOUDFLARE_TURN_KEY_ID` | 스택 config `cloudflareTurnKeyId` |
| `SQS_<큐 이름>_QUEUE_URL` | 큐 URL 7개. 큐 이름은 대문자로 쓰고 `-`를 `_`로 변경. 예: `SQS_PERIODIC_COMMAND_QUEUE_URL` |
| `SQS_PARROT_SOUND_DETECTION_DLQ_URL` | `parrot-sound-detection-dlq` 큐 URL |
| `SQS_MIMICRY_JUDGMENT_DLQ_URL` | `mimicry-judgment-dlq` 큐 URL |

### 시크릿

| 변수 | `valueFrom` |
|---|---|
| `DB_PASSWORD` | `<RDS 관리 시크릿 ARN>:password::` |
| `BACKOFFICE_PASSWORD` | `<앱 시크릿 ARN>:backoffice_password::` |
| `SUPABASE_SECRET_KEY` | `<앱 시크릿 ARN>:supabase_secret_key::` |
| `OAUTH_CREDENTIALS_KEY` | `<앱 시크릿 ARN>:oauth_credentials_key::` |
| `GOOGLE_CLIENT_SECRET` | `<앱 시크릿 ARN>:google_client_secret::` |
| `APPLE_PRIVATE_KEY` | `<앱 시크릿 ARN>:apple_private_key::` |
| `KAKAO_ADMIN_KEY` | `<앱 시크릿 ARN>:kakao_admin_key::` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | `<앱 시크릿 ARN>:firebase_service_account_json::` |
| `SENTRY_API_TOKEN` | `<앱 시크릿 ARN>:sentry_api_token::` |
| `CLOUDFLARE_TURN_API_TOKEN` | `<앱 시크릿 ARN>:cloudflare_turn_api_token::` |

### task role 권한

| 역할 | 대상 | 액션 |
|---|---|---|
| api | 데이터 버킷 객체 | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:PutObjectTagging` |
| api | `notification`, `withdrawal` 큐 | `sqs:SendMessage` |
| api | KVS 채널 `jn-buddybird-<env>-*` | 시그널링 채널 생성, 조회, 삭제와 `ConnectAsMaster`, `ConnectAsViewer`, `GetIceServerConfig` |
| consumer | `upload-confirmation`, `judgment-result`, `notification`, `withdrawal`, `periodic-command`, `parrot-sound-detection-dlq`, `mimicry-judgment-dlq` 큐 | 수신, 삭제, visibility 변경, 속성 조회 |
| consumer | `parrot-sound-detection`, `mimicry-judgment`, `notification`, `withdrawal` 큐 | `sqs:SendMessage` |
| consumer | 데이터 버킷 객체 | api와 같음 |

dev는 api와 consumer가 task 하나에서 실행되므로 api task role이 consumer 권한도 갖습니다.

### consumer

consumer는 api와 같은 이미지를 `python -m app.consumer` 명령으로 실행하고 HTTP 요청을 받지 않습니다.
환경 변수와 시크릿은 api 컨테이너와 같습니다.

| 항목 | prod | dev |
|---|---|---|
| 실행 위치 | 별도 ECS 서비스 `jn-buddybird-api-prod-consumer` | api task의 두 번째 컨테이너 |
| capacity provider | `FARGATE` | api와 같음 |
| task role | `jn-buddybird-api-prod-consumer-task` | api task role |
| 로그 | `/ecs/jn-buddybird-api-prod-consumer` | `/ecs/jn-buddybird-api-dev`의 `consumer/` 스트림 |
| ALB 연결 | X | X |

dev의 consumer 컨테이너는 `essential`이 아니므로 종료돼도 api 컨테이너는 계속 실행됩니다.
ECS는 종료된 consumer 컨테이너를 다시 시작하지 않으므로 dev api를 재배포해야 consumer가 다시 실행됩니다.

## 메시지 큐

서비스 사이의 메시지는 보내는 쪽이 대상 SQS 큐에 직접 전송합니다.
큐 이름은 `jn-buddybird-<env>-<용도>`이고 큐마다 `-dlq`를 붙인 DLQ가 있습니다.

| 큐 | 읽는 프로세스 | 메시지 | 보내는 쪽 | visibility timeout |
|---|---|---|---|---|
| `upload-confirmation` | consumer | S3 Object Created 이벤트 | 데이터 버킷의 EventBridge rule | 60초 |
| `parrot-sound-detection` | 앵무새 소리 판별 함수 | 명령 `audio.detect_parrot` | consumer | 360초 |
| `mimicry-judgment` | 모사 판정 함수 | 명령 `audio.judge_mimic` | consumer | 720초 |
| `judgment-result` | consumer | 이벤트 `audio.parrot_detected`, `audio.mimic_judged` | 앵무새 소리 판별 함수, 모사 판정 함수 | 30초 |
| `notification` | consumer | 명령 `notification.send` | api, consumer | 30초 |
| `withdrawal` | consumer | 명령 `withdrawal.process` | api, consumer | 300초 |
| `periodic-command` | consumer | 명령 `withdrawal.dispatch`, `session.check_heartbeats` | 1분 주기 스케줄 | 30초 |

`parrot-sound-detection`의 360초는 앵무새 소리 판별 함수 제한 시간 60초의 6배이고, `mimicry-judgment`의 720초는 모사 판정 함수 제한 시간 120초의 6배입니다.
함수 제한 시간의 6배는 AWS가 SQS 트리거에 권장하는 최소값입니다.
consumer는 `parrot-sound-detection-dlq`와 `mimicry-judgment-dlq`도 읽어 앵무새 소리 판정이나 단어 모사 판정에 실패한 소리를 failed로 표시합니다.
메시지 type은 `<대상>.<동사>` 형태이고 명령은 명령형으로, 이벤트는 과거형으로 짓습니다.

| 항목 | 값 |
|---|---|
| `maxReceiveCount` | 5 |
| 큐 보존 기간 | `periodic-command`는 60초, 나머지는 SQS 기본값인 4일 |
| DLQ 보존 기간 | 14일 |
| DLQ 알람 | 메시지 수가 0보다 크면 `jn-buddybird-<env>-alarms` topic으로 팀 이메일 발송 |
| 업로드 이벤트 rule | `jn-buddybird-<env>-upload-created` |
| 업로드 이벤트 key 조건 | `upload/` prefix, `user/*/word/*`, `user/*/session/*`, `user/*/petcam/*` |
| 1분 주기 스케줄 | `jn-buddybird-<env>-withdrawal-dispatch`, `jn-buddybird-<env>-heartbeat-check` |
| 스케줄 실행 역할 | `jn-buddybird-<env>-scheduler` |

변환된 이미지와 서버 내부 업로드의 key는 업로드 이벤트 조건에 해당하지 않으므로 이벤트가 반복되지 않습니다.
첫 적용 뒤 수신 메일에서 구독을 승인해야 알람 메일을 받습니다.
큐 URL은 stack output `queue_urls`로 조회합니다.

## audio-ai

`buddybird-ai-api` 레포지토리의 Lambda 함수 두 개입니다.
앵무새 소리 판별 함수는 `parrot-sound-detection` 큐의 요청으로 앵무새 소리를 판정하고, 모사 판정 함수는 `mimicry-judgment` 큐의 요청으로 단어 모사를 판정합니다.
두 함수 모두 결과를 `judgment-result` 큐로 보냅니다.
Lambda 함수와 SQS 트리거는 스택 config `audioAi`가 있는 스택에만 만듭니다.

### ECR 저장소

| 항목 | 값 |
|---|---|
| 이름 | `jn-buddybird-parrot-detection`, `jn-buddybird-mimic-judgment` |
| 태그 변경 | IMMUTABLE |
| 스캔 | 푸시 시 |
| 태그 없는 이미지 | 7일 후 삭제 |
| 보관 | 최근 20개 |

이전 함수가 사용하던 `jn-buddybird-audio-ai` 저장소도 같은 설정으로 남아 있고, 배포 역할에는 이 저장소의 권한이 없습니다.

ECR 저장소 정책은 Pulumi가 관리하지 않습니다.
각 저장소의 이미지로 함수를 처음 만들 때 Lambda가 `lambda.amazonaws.com`의 이미지 읽기를 허용하는 statement를 저장소 정책에 직접 추가합니다.
나중에 이 저장소 정책을 Pulumi로 관리하게 되면 이 statement도 코드에 넣어야 합니다.
넣지 않으면 Pulumi가 정책을 적용할 때 이 statement가 지워지고, 함수가 이미지를 가져오지 못합니다.

### 배포 역할

#### 신뢰 정책

- 이름: `jn-buddybird-audio-ai-deploy`
- `buddybird-ai-api` 레포지토리
  - `ref:refs/heads/main`
  - `ref:refs/heads/dev`

#### 권한

| 대상 | 액션 |
|---|---|
| `*` | `ecr:GetAuthorizationToken` |
| ECR 저장소 `jn-buddybird-parrot-detection`, `jn-buddybird-mimic-judgment` | 레이어 업로드, `ecr:PutImage`, `ecr:DescribeImages` |
| Lambda 함수 `jn-buddybird-parrot-detection-*`, `jn-buddybird-mimic-judgment-*` | `lambda:UpdateFunctionCode`, `lambda:GetFunction` |

### Lambda 함수

| 항목 | 앵무새 소리 판별 | 모사 판정 |
|---|---|---|
| 함수 이름 | `jn-buddybird-parrot-detection-<env>` | `jn-buddybird-mimic-judgment-<env>` |
| ECR 저장소 | `jn-buddybird-parrot-detection` | `jn-buddybird-mimic-judgment` |
| 패키지 | 컨테이너 이미지 | 컨테이너 이미지 |
| 아키텍처 | arm64 | arm64 |
| memory | 4096MB | 4096MB |
| 제한 시간 | 60초 | 120초 |
| VPC | X | X |
| 이미지 태그 | `<env>-bootstrap` | `<env>-bootstrap` |
| 로그 그룹 | `/aws/lambda/jn-buddybird-parrot-detection-<env>`, 30일 보관 | `/aws/lambda/jn-buddybird-mimic-judgment-<env>`, 30일 보관 |

함수를 만들기 전에 각 ECR 저장소에 `<env>-bootstrap` 태그 이미지가 있어야 합니다.
image index는 여러 플랫폼 이미지나 provenance 증명을 하나로 묶은 manifest 목록입니다.
Lambda는 image index로 push된 이미지를 받지 않으므로, bootstrap 이미지는 `--platform linux/arm64 --provenance=false`로 빌드해 push합니다.
Pulumi는 함수의 `imageUri`를 `ignoreChanges`로 제외하고, 이후 이미지는 `buddybird-ai-api`의 deploy 워크플로가 변경합니다.

### 환경 변수

두 함수의 환경 변수는 같습니다.

| 변수 | 값 |
|---|---|
| `ENV` | `dev` 또는 `prod` |
| `S3_BUCKET` | 데이터 버킷 이름 |
| `SQS_JUDGMENT_RESULT_QUEUE_URL` | `judgment-result` 큐 URL |
| `SENTRY_DSN` | 스택 config `audioAiSentryDsn` |

### 실행 역할 권한

| 대상 | 앵무새 소리 판별 | 모사 판정 | 액션 |
|---|---|---|---|
| CloudWatch Logs | O | O | `AWSLambdaBasicExecutionRole` |
| 데이터 버킷 `user/*/session/*` 객체 | O | O | `s3:GetObject` |
| 데이터 버킷 `user/*/word/*`, `preset/*` 객체 | X | O | `s3:GetObject` |
| `parrot-sound-detection` 큐 | O | X | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` |
| `mimicry-judgment` 큐 | X | O | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` |
| `judgment-result` 큐 | O | O | `sqs:SendMessage` |

### SQS 트리거

| 큐 | 함수 | 배치 크기 | DLQ |
|---|---|---|---|
| `parrot-sound-detection` | 앵무새 소리 판별 | 10 | `parrot-sound-detection-dlq` |
| `mimicry-judgment` | 모사 판정 | 1 | `mimicry-judgment-dlq` |

두 트리거 모두 응답 유형은 `ReportBatchItemFailures`이고, 최대 동시 실행은 스택 config `audioAi.maximumConcurrency`입니다.
함수가 `batchItemFailures`로 돌려준 메시지는 삭제되지 않고, 큐의 visibility timeout이 지나면 다시 처리됩니다.
5번 실패한 메시지는 각 큐의 DLQ로 옮겨집니다.

## backoffice frontend

### ECR 저장소

| 항목 | 값 |
|---|---|
| 이름 | `jn-buddybird-backoffice-frontend` |
| 태그 없는 이미지 | 7일 후 삭제 |
| 보관 | 최근 20개 |

### 배포 역할

#### 신뢰 정책

- 이름: `jn-buddybird-backoffice-frontend-deploy`
- `buddybird-backoffice-frontend` 레포지토리
  - `ref:refs/heads/main`

#### 권한

| 대상 | 액션 |
|---|---|
| `*` | `ecr:GetAuthorizationToken`, `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition` |
| ECR 저장소 | 레이어 업로드, `ecr:PutImage`, `ecr:DescribeImages` |
| ECS 서비스 `jn-buddybird-backoffice-frontend-*` | `ecs:UpdateService`, `ecs:DescribeServices` |
| `*-exec` 역할 | `iam:PassRole` (`ecs-tasks.amazonaws.com` 한정) |

### ECS 서비스

| 항목 | 값 |
|---|---|
| 아키텍처 | ARM64 Fargate |
| cpu | 256 |
| memory | 512 |
| 포트 | 3000 |
| 환경 | prod |
| 헬스체크 | `/api/healthz`, 10초 간격 |
| capacity provider | `spot` |
| 타깃 그룹 이름 | `jn-buddybird-bo-fe-prod` |
| 역할 | execution role만 사용 |
| circuit breaker | 활성화, 실패 시 자동 롤백 |
| task role | X |
| 환경 변수 | X |
| 시크릿 | X |

## mbti web

### ECR 저장소

| 항목 | 값 |
|---|---|
| 이름 | `jn-buddybird-mbti` |
| 태그 변경 | IMMUTABLE |
| 스캔 | 푸시 시 |
| 태그 없는 이미지 | 7일 후 삭제 |
| 보관 | 최근 20개 |

### 배포 역할

#### 신뢰 정책

- 이름: `jn-buddybird-mbti-deploy`
- `buddybird-mbti-web` 레포지토리
  - `ref:refs/heads/main`
  - `environment:prod`

#### 권한

| 대상 | 액션 |
|---|---|
| `*` | `ecr:GetAuthorizationToken`, `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition` |
| ECR 저장소 | 레이어 업로드, `ecr:PutImage`, `ecr:DescribeImages` |
| ECS 서비스 `jn-buddybird-mbti-*` | `ecs:UpdateService`, `ecs:DescribeServices` |
| `*-exec` 역할 | `iam:PassRole` (`ecs-tasks.amazonaws.com` 한정) |

### ECS 서비스

| 항목 | 값 |
|---|---|
| 환경 | prod |
| 호스트명 | `mbti.buddybird.xyz` |
| 아키텍처 | ARM64 Fargate |
| cpu | 256 |
| memory | 512 |
| 포트 | 3000 |
| 헬스체크 | `/api/healthz`, 10초 간격 |
| capacity provider | `on-demand` |
| 타깃 그룹 이름 | `jn-buddybird-mbti-prod` |
| 역할 | execution role만 사용 |
| circuit breaker | 활성화, 실패 시 자동 롤백 |
| task role | X |
| 환경 변수 | X |
| 시크릿 | X |

### MBTI CloudFront

첫 접속의 이미지 변환 결과를 공유하고 ECS task 교체 후에도 캐시를 재사용하는 전용 distribution입니다.
Origin은 기존 ALB이며, 모든 경로에서 `Host`를 전달하고 HTTPS로 연결합니다.
랜딩의 rewrite 함수와 오류 페이지 치환은 사용하지 않습니다.

| 경로 | 캐시 | Origin request policy |
|---|---|---|
| `/_next/image` | `url`, `w`, `q`, `Accept`별 캐시, 쿠키 제외 | `HostHeaderOnly` |
| `/_next/static/*` | `CachingOptimized`, 압축 활성화 | `HostHeaderOnly` |
| 그 외: HTML, RSC, API, 원본 PNG | `CachingDisabled` | `AllViewerAndCloudFrontHeaders-2022-06` |

기본 경로는 `CloudFront-Viewer-Country` 같은 CloudFront 생성 헤더까지 origin에 전달합니다.
MBTI 웹이 이 헤더로 한국어·영어를 고르므로, 같은 주소가 국가별로 다른 HTML을 응답합니다.
기본 경로의 캐시를 켜려면 국가 헤더를 캐시 키에 넣어야 합니다.

이미지 캐시 TTL은 최소·기본 0초, 최대 365일이며 origin의 `Cache-Control`을 따릅니다.
따라서 기존 앵무새 이미지의 4시간 TTL도 유지됩니다.
403·404·500·502·503·504의 오류 캐시 TTL은 0초입니다.
CDN과 Next.js 모두 캐시가 없는 이미지의 첫 요청에는 변환 시간이 발생합니다.

| Stack output | 용도 |
|---|---|
| `mbti_web_distribution_id` | distribution 상태·지표 조회 |
| `mbti_web_distribution_domain` | DNS 전환 전 CDN 접속 검증 |
| `mbti_web_cdn_enabled` | DNS 전환 상태 |

#### 생성·검증·DNS 전환

`buddybird-app:mbtiCdnEnabled`의 기본값은 `false`입니다. 첫 적용에서는 CDN만 생성하고 DNS는 ALB를 유지합니다.
다음 명령은 `buddybird-app/`에서 실행합니다. AWS 인증은 `joynnovate` profile을 사용합니다.

```bash
export AWS_PROFILE=joynnovate
pulumi preview --stack prod --diff
pulumi up --stack prod
mbti_cdn_domain=$(pulumi stack output mbti_web_distribution_domain --stack prod)
curl --connect-to "mbti.buddybird.xyz:443:${mbti_cdn_domain}:443" \
  --compressed -sS -D - -o /dev/null https://mbti.buddybird.xyz/
```

같은 접속 방식으로 실제 페이지의 `/_next/image` URL과 JS·CSS·글꼴을 GET 요청합니다.
같은 이미지 URL과 `Accept`를 반복 요청했을 때 `X-Cache: Hit from cloudfront`인지 확인합니다.
Next.js의 `x-nextjs-cache`는 CDN 적중 여부를 나타내지 않습니다.
이미지의 `url`, `w`, `q`, `Accept`를 바꿔 응답이 섞이지 않는지도 확인합니다.
HTML·RSC·API는 캐시되지 않아야 합니다.

TLS·라우팅·캐시 검증을 통과한 뒤 DNS를 전환합니다.

```bash
pulumi config set buddybird-app:mbtiCdnEnabled true --stack prod
pulumi preview --stack prod --diff
pulumi up --stack prod
```

변경된 `Pulumi.prod.yaml`은 배포 설정으로 함께 관리합니다. DNS TTL은 300초이며 Cloudflare proxy는 비활성입니다.
기존 CI `buddybird-app up` workflow로도 같은 설정을 적용할 수 있습니다.
배포 때마다 전체 CDN 캐시를 무효화하지 않습니다. 해시가 바뀐 정적 파일은 새 경로로 제공됩니다.

전환 후 빈 브라우저 캐시에서 검사 진행·결과 URL 직접 접속·공유 이미지 생성을 확인합니다.
CDN 캐시를 채운 다음 데스크톱 1280px·모바일 화면 390px에서 각각 5회 측정하며,
초기 이미지 11개 로딩의 중앙값 1초 이하를 목표로 합니다. CDN MISS 시간은 별도로 기록합니다.

#### 복구

TLS 오류·이미지 혼선·기능 오류가 발생하면 아래 설정을 적용해 DNS를 기존 ALB로 복구합니다.
CloudFront는 삭제하지 않으며 복구 중에도 기존 CDN 경로를 제공합니다.

```bash
pulumi config set buddybird-app:mbtiCdnEnabled false --stack prod
pulumi preview --stack prod --diff
pulumi up --stack prod
```

## 펫캠

모바일 앱의 펫캠은 기기끼리 영상을 직접 주고받고, 직접 연결되지 않는 통신망에서는 Cloudflare Realtime TURN으로 중계합니다.
연결 정보는 Supabase Realtime 채널로 교환하고, TURN 접속 정보는 api가 발급합니다.

### TURN 키

| 항목 | 값 |
|---|---|
| 리소스 | Cloudflare Realtime TURN 키, `dev` 스택은 `buddybird-petcam-dev`, `prod` 스택은 `buddybird-petcam` |
| 생성 | Cloudflare 대시보드에서 직접 생성 |
| 계정 | `buddybird.xyz` zone이 속한 Cloudflare 계정 |
| 요금 | Realtime 무료 구간은 계정 전체 합산 월 1,000GB |

`pulumi-cloudflare` 6.x의 `CallsTurnApp`은 접속 정보 발급에 쓰는 API 토큰을 돌려주지 않아 키를 Pulumi로 만들지 않습니다.
API 토큰은 키를 만드는 순간에만 확인할 수 있습니다.
`dev`와 `prod` 스택은 서로 다른 키를 사용하므로, 사용량을 스택별로 확인하고 키를 따로 교체할 수 있습니다.

| 스택 config | 내용 | api 전달 방식 |
|---|---|---|
| `cloudflareTurnKeyId` | TURN 키 ID | 환경 변수 `CLOUDFLARE_TURN_KEY_ID` |
| `cloudflareTurnApiToken` | TURN 접속 정보 발급에 쓰는 API 토큰, secret | 앱 시크릿의 `cloudflare_turn_api_token` |

api는 로그인한 사용자의 요청을 받으면 이 값으로 Cloudflare에서 24시간 동안 유효한 접속 정보를 발급받아 돌려줍니다.

### 채널 권한

연결 정보는 `petcam:<사용자 id>:<세션 id>` 이름의 Supabase Realtime private 채널로 주고받습니다.
로그인한 사용자는 본인 id로 시작하는 채널에서만 메시지를 받고 보낼 수 있습니다.
정책은 Supabase 대시보드에서 관리하며, `dev`와 `prod` 프로젝트에 다음 SQL을 적용했습니다.

```sql
drop policy if exists "petcam members can receive broadcasts" on realtime.messages;
create policy "petcam members can receive broadcasts"
on realtime.messages
for select
to authenticated
using (
	realtime.messages.extension = 'broadcast'
	and split_part(realtime.topic(), ':', 1) = 'petcam'
	and split_part(realtime.topic(), ':', 2) = (select auth.uid())::text
);

drop policy if exists "petcam members can send broadcasts" on realtime.messages;
create policy "petcam members can send broadcasts"
on realtime.messages
for insert
to authenticated
with check (
	realtime.messages.extension = 'broadcast'
	and split_part(realtime.topic(), ':', 1) = 'petcam'
	and split_part(realtime.topic(), ':', 2) = (select auth.uid())::text
);
```

## 랜딩

### 버킷

| 항목 | 값 |
|---|---|
| 암호화 | SSE-S3 |
| public access | 차단 |
| 읽기 허용 | CloudFront만 `s3:GetObject` |
| 버킷 정책 | TLS 필수 |

### CloudFront

| behavior | 오리진 | 캐시 정책 |
|---|---|---|
| 기본 | S3 | `Managed-CachingOptimized` |
| `/api/*` | ALB | `Managed-CachingDisabled`, `Managed-AllViewerAndCloudFrontHeaders-2022-06` |

| 항목 | 값 |
|---|---|
| 별칭 | `buddybird.xyz`, `www.buddybird.xyz` |
| S3 접근 | OAC |
| 403 응답 | `/index.html`로 전환, 404 상태 코드 반환 |

#### rewrite 함수

- `www.` 요청을 루트 도메인으로 301 리다이렉트
- `/`로 끝나거나 확장자 없는 경로에 `index.html` 추가

### 배포 역할

#### 신뢰 정책

- 이름: `jn-buddybird-site-deploy`
- `buddybird-landing` 레포지토리
  - `ref:refs/heads/main`

#### 권한

| 대상 | 액션 |
|---|---|
| 랜딩 버킷 | `s3:ListBucket` |
| 랜딩 버킷 객체 | `s3:PutObject`, `s3:DeleteObject`, `s3:GetObject` |
| CloudFront 배포 | `cloudfront:CreateInvalidation` |

## 리스너 규칙 우선순위

두 스택이 `infra`의 HTTPS 리스너 하나를 함께 사용합니다.
우선순위는 리스너 안에서 고유해야 하므로 스택 config에 값을 추가할 때 이 표에서 겹치지 않는 값을 고릅니다.

| 우선순위 | 스택 | 호스트명 | 경로 |
|---|---|---|---|
| 10 | `prod` | `buddybird.xyz` | `/api/*` |
| 20 | `dev` | `dev.buddybird.xyz` | `/api/*` |
| 30 | `prod` | `backoffice.buddybird.xyz` | 전체 |
| 50 | `prod` | `mbti.buddybird.xyz` | 전체 |

## DNS

| 호스트명 | 스택 | 소유 컴포넌트 | 대상 | TTL | proxied |
|---|---|---|---|---|---|
| `buddybird.xyz` | `prod` | `Landing` | CloudFront | 300초 | 비활성 |
| `www.buddybird.xyz` | `prod` | `Landing` | CloudFront | 300초 | 비활성 |
| `dev.buddybird.xyz` | `dev` | `Api` | ALB | 300초 | 비활성 |
| `backoffice.buddybird.xyz` | `prod` | `WebService` | ALB | 300초 | 비활성 |
| `mbti.buddybird.xyz` | `prod` | `WebService` | `mbtiCdnEnabled=true`: MBTI CloudFront, 기본값: ALB | 300초 | 비활성 |

## 배포

### 분담

| 서비스 | 배포 레포 |
|---|---|
| api | `buddybird-api` GitHub Actions |
| backoffice frontend | `buddybird-backoffice-frontend` GitHub Actions |
| mbti web | `buddybird-mbti-web` GitHub Actions |
| 랜딩 | `buddybird-landing` GitHub Actions |
| audio-ai | `buddybird-ai-api` GitHub Actions |

ECS 서비스의 `desiredCount`는 Pulumi가 변경하지 않습니다.
prod api는 최초 1회 아래 명령으로 task를 2개로 설정합니다.

```bash
aws ecs update-service --cluster jn-cluster --service jn-buddybird-api-prod --desired-count 2
```

prod consumer 서비스는 task 0개로 만들어집니다.
서비스가 `bootstrap` 태그 이미지로 생성되므로 api 이미지를 배포한 뒤 아래 명령으로 시작합니다.

```bash
aws ecs update-service --cluster jn-cluster --service jn-buddybird-api-prod-consumer --desired-count 1
```

이 스택에서 컨테이너 정의를 변경한 경우 `pulumi up` 후 서비스를 수동으로 갱신합니다.

```bash
aws ecs update-service --cluster jn-cluster --service <서비스> \
  --task-definition <최신 revision> --force-new-deployment
```

### api 배포

| 브랜치 | 동작 |
|---|---|
| `dev` | 이미지 빌드와 ECR 푸시 → 마이그레이션 task 실행 → dev 서비스 갱신 |
| `main` | 마이그레이션 task 실행 → prod 서비스 갱신 → prod consumer 서비스 갱신 |

워크플로는 task definition의 모든 컨테이너 이미지를 교체하므로 dev의 consumer 컨테이너도 api와 같은 버전으로 배포됩니다.
마이그레이션은 `api` 컨테이너만 담은 `<서비스>-migration` task definition으로 실행합니다.

### backoffice frontend 배포

| 트리거 | 동작 |
|---|---|
| release-please 릴리즈 PR merge | 이미지 빌드와 ECR push 후 prod 서비스 갱신 |

### mbti web 배포

| 트리거 | 동작 |
|---|---|
| release-please 릴리즈 PR merge | 이미지 빌드와 ECR push 후 prod 서비스 갱신 |

### audio-ai 배포

| 트리거 | 동작 |
|---|---|
| release-please 릴리즈 PR 머지(dev) | 두 저장소에 이미지 빌드와 ECR 푸시 → 두 dev 함수의 이미지 변경 |
| push to main | 두 prod 함수의 이미지 변경 |

### 수동 단계

첫 적용 전에 스택마다 secret을 저장합니다.

```bash
pulumi config set --stack <스택> --secret cloudflare:apiToken <토큰>
pulumi config set --stack <스택> --secret backofficePassword <비밀번호>
pulumi config set --stack <스택> --secret readonlyDbPassword <비밀번호>
pulumi config set --stack <스택> supabaseUrl <Supabase 프로젝트 URL>
pulumi config set --stack <스택> supabasePublishableKey <publishable key>
pulumi config set --stack <스택> googleClientId <Google OAuth 클라이언트 ID>
pulumi config set --stack <스택> appleClientIds '["<Apple 앱 ID>"]'
pulumi config set --stack <스택> appleTeamId <Apple 팀 ID>
pulumi config set --stack <스택> appleKeyId <Apple 로그인 키 ID>
pulumi config set --stack <스택> cloudflareTurnKeyId <Cloudflare TURN 키 ID>
pulumi config set --stack <스택> --secret supabaseSecretKey <secret key>
pulumi config set --stack <스택> --secret oauthCredentialsKey <Fernet 키>
pulumi config set --stack <스택> --secret googleClientSecret <클라이언트 secret>
pulumi config set --stack <스택> --secret kakaoAdminKey <admin 키>
pulumi config set --stack <스택> --secret cloudflareTurnApiToken <Cloudflare TURN API 토큰>
pulumi config set --stack <스택> --secret applePrivateKey < <p8 파일>
pulumi config set --stack <스택> --secret firebaseServiceAccountJson < <서비스 계정 JSON 파일>
```

여러 줄인 `applePrivateKey`와 `firebaseServiceAccountJson`은 값을 stdin으로 넘깁니다.
`backofficePassword`와 `readonlyDbPassword`는 현재 `dev`와 `prod` 스택이 같은 값을 사용합니다.
Supabase 프로젝트, Google OAuth 클라이언트, Apple 앱 ID와 키는 스택마다 다른 값을 사용합니다.

secret을 변경한 뒤에는 해당 스택의 api를 재배포해야 합니다.
ECS는 task를 시작할 때 시크릿을 읽기 때문에 재배포 전까지 이전 값으로 동작합니다.

### readonly DB 사용자 생성

최초 1회 SSM port forwarding으로 master 사용자에 접속해 dev, prod 각각 실행합니다.
접속 방법은 `ssm-db-access.md`를 참고합니다.

```sql
CREATE USER readonly WITH PASSWORD '<readonlyDbPassword에 설정한 비밀번호>';
GRANT CONNECT ON DATABASE buddybird TO readonly;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;
```

### 최초 구축 순서

1. `buddybird-shared` 적용
2. api ECR에 `bootstrap` 태그로, backoffice frontend ECR에 `dev-bootstrap`과 `prod-bootstrap` 태그로, mbti web ECR에 `prod-bootstrap` 태그로, 앵무새 소리 판별 ECR과 모사 판정 ECR에 각각 `dev-bootstrap`과 `prod-bootstrap` 태그로 이미지 푸시
3. `buddybird-app` 적용
