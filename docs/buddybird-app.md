# buddybird-app

buddybird 전용 인프라의 구성과 배포 절차를 다룬다.

## 파일 구성

| 파일 | 리소스 |
| --- | --- |
| `__main__.py` | - 데이터 버킷<br>- 환경별 구성<br>- DNS 레코드<br>- 출력값 |
| `deploy.py` | - Elastic Container Registry(ECR) 저장소<br>- 배포 역할<br>- RDS 비밀번호 rotation 재배포 Lambda |
| `data.py` | - Relational Database Service(RDS) 서브넷 그룹<br>- RDS 인스턴스<br>- 앱 시크릿 |
| `service.py` | - 로그 그룹<br>- Identity and Access Management(IAM) 역할<br>- task definition<br>- 타깃 그룹<br>- 리스너 규칙<br>- Elastic Container Service(ECS) 서비스 |
| `edge.py` | - 사이트 버킷<br>- CloudFront<br>- Origin Access Control(OAC)<br>- rewrite 함수 |

`organization/joynnovate-infra/prod`의 출력값을 StackReference로 참조한다.

## 환경

`prod` 스택 하나에서 환경 생성 함수를 환경마다 호출한다.

| 환경 | api 호스트명 | backoffice frontend 호스트명 |
| --- | --- | --- |
| prod | `buddybird.xyz` | `backoffice.buddybird.xyz` |
| dev | `dev.buddybird.xyz` | `dev-backoffice.buddybird.xyz` |

## 이름 규칙

계정이나 리전에서 유일해야 하는 리소스에 환경 접미사를 추가한다.

### 환경별 이름

| 리소스 | 이름 패턴 |
| --- | --- |
| api: RDS, ECS 서비스, 타깃 그룹, task definition family, 앱 시크릿 | `jn-buddybird-api-<env>` |
| api: task role | `jn-buddybird-api-<env>-task` |
| api: execution role | `jn-buddybird-api-<env>-exec` |
| api: 로그 그룹 | `/ecs/jn-buddybird-api-<env>` |
| api: rotation 재배포 Lambda, 역할, EventBridge 규칙 | `jn-buddybird-api-<env>-rotation` |
| 데이터 버킷 | `jn-buddybird-v1-data-<env>-<계정>-<리전>` |
| backoffice frontend: ECS 서비스, task definition family | `jn-buddybird-backoffice-frontend-<env>` |
| backoffice frontend: 타깃 그룹 | `jn-buddybird-bo-fe-<env>` |
| backoffice frontend: execution role | `jn-buddybird-backoffice-frontend-<env>-exec` |
| backoffice frontend: 로그 그룹 | `/ecs/jn-buddybird-backoffice-frontend-<env>` |

### 공통 이름

| 리소스 | 이름 |
| --- | --- |
| api ECR 저장소 | `jn-buddybird-api` |
| api 배포 역할 | `jn-buddybird-api-deploy` |
| backoffice frontend ECR 저장소 | `jn-buddybird-backoffice-frontend` |
| 사이트 버킷 | `jn-buddybird-site-<계정>-<리전>` |
| 사이트 배포 역할 | `jn-buddybird-site-deploy` |

## api

### ECR 저장소

| 항목 | 값 |
| --- | --- |
| 이름 | `jn-buddybird-api` |
| 태그 변경 | IMMUTABLE |
| 스캔 | 푸시 시 |
| 태그 없는 이미지 | 7일 후 자동 삭제 |
| 보관 | 최근 20개 |

### 배포 역할

GitHub Actions OpenID Connect(OIDC)용으로 정의한 역할이다.

#### 신뢰 정책

- 이름: `jn-buddybird-api-deploy`
- `buddybird-api` 레포, `ref:refs/heads/main`
- `buddybird-api` 레포, `ref:refs/heads/dev`
- `buddybird-api` 레포, `environment:prod`

#### 권한

| 대상 | 액션 |
| --- | --- |
| `*` | - `ecr:GetAuthorizationToken`<br>- `ecs:RegisterTaskDefinition`<br>- `ecs:DescribeTaskDefinition` |
| ECR 저장소 | - 레이어 업로드<br>- `ecr:PutImage`<br>- `ecr:DescribeImages` |
| ECS 서비스 `jn-buddybird-api-*` | - `ecs:UpdateService`<br>- `ecs:DescribeServices` |
| task definition `jn-buddybird-api-*` | `ecs:RunTask` |
| task | `ecs:DescribeTasks` (클러스터 Amazon Resource Name(ARN) 조건) |
| `*-task`, `*-exec` 역할 | `iam:PassRole` (`ecs-tasks.amazonaws.com` 한정) |
| 로그 그룹 `/ecs/jn-buddybird-api-*` | - `logs:GetLogEvents`<br>- `logs:DescribeLogStreams` |

### RDS

| 항목 | 값 |
| --- | --- |
| 엔진 | PostgreSQL 17 |
| 인스턴스 | db.t4g.micro |
| 스토리지 | gp3 20GB, 암호화 |
| 백업 보존 | 7일 |
| 비밀번호 | `manage_master_user_password` |
| 서브넷 | private, 서브넷 그룹 환경 공유 |

### 비밀번호 rotation 재배포

RDS 관리 시크릿의 `AWSCURRENT` 라벨이 이동하면 api 서비스를 force new deployment로 갱신한다.

| 리소스 | 값 |
| --- | --- |
| EventBridge 규칙 | `Secret Label Updated`, `labelUpdated: AWSCURRENT`, `resources`에 RDS 관리 시크릿 ARN |
| Lambda | Python 3.14, `ecs:UpdateService` 호출 |
| Lambda 역할 권한 | 해당 환경 ECS 서비스에 `ecs:UpdateService`, `AWSLambdaBasicExecutionRole` |

### 앱 시크릿

토큰 서명키와 backoffice 비밀번호를 JSON 하나로 저장한다.

| JSON 키 | 용도 |
| --- | --- |
| `access_token_key` | 액세스 토큰 서명 |
| `refresh_token_key` | 리프레시 토큰 서명 |
| `backoffice_password` | backoffice 로그인 |

### 데이터 버킷

환경별 오디오 파일을 저장한다.

#### CORS

| 환경 | 허용 출처 |
| --- | --- |
| dev | - `https://dev.buddybird.xyz`<br>- `https://dev-backoffice.buddybird.xyz` |
| prod | - `https://buddybird.xyz`<br>- `https://backoffice.buddybird.xyz` |
| local | `http://localhost:3000` |

#### 버킷 설정

| 항목 | 값 |
| --- | --- |
| 암호화 | SSE-S3 |
| public access | 차단 |
| 버킷 정책 | TLS 전용 |
| multipart 업로드 | 미완료 시 7일 후 삭제 |

### ECS 서비스

| 항목 | 값 |
| --- | --- |
| 아키텍처 | ARM64 Fargate |
| cpu | 256 |
| memory | 512 |
| 포트 | 8000 |
| 헬스체크 | `/api/healthz` |
| 서브넷 | public, `assign_public_ip` |
| circuit breaker | 활성, 실패 시 자동 롤백 |

### 환경 변수

| 변수 | 값 |
| --- | --- |
| `BUDDYBIRD_ENV` | `dev` 또는 `prod` |
| `DB_HOST` | RDS 주소 |
| `DB_NAME` | `buddybird` |
| `DB_USER` | `buddybird` |
| `S3_BUCKET_NAME` | 데이터 버킷 이름 |
| `S3_BUCKET_DOMAIN` | `https://<버킷>.s3.<리전>.amazonaws.com` |
| `AUTH_ALGORITHM` | `HS256` |
| `AUTH_ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` |
| `AUTH_REFRESH_TOKEN_EXPIRE_MINUTES` | `20160` |
| `FRONTEND_CORS_ORIGIN` | `["https://<backoffice frontend 호스트명>"]` |

### 시크릿

Secrets Manager JSON 키 선택자로 주입한다.

| 변수 | `valueFrom` |
| --- | --- |
| `DB_PASSWORD` | `<RDS 관리 시크릿 ARN>:password::` |
| `AUTH_ACCESS_TOKEN_SECRET_KEY` | `<앱 시크릿 ARN>:access_token_key::` |
| `AUTH_REFRESH_TOKEN_SECRET_KEY` | `<앱 시크릿 ARN>:refresh_token_key::` |
| `BACKOFFICE_PASSWORD` | `<앱 시크릿 ARN>:backoffice_password::` |

## backoffice frontend

### ECR 저장소

| 항목 | 값 |
| --- | --- |
| 이름 | `jn-buddybird-backoffice-frontend` |
| 구성 | api ECR 저장소와 동일 |
| 태그 없는 이미지 | 7일 후 자동 삭제 |
| 보관 | 최근 20개 |
| 환경 구분 | 이미지 태그에 `dev-`, `prod-` 접두사 |

### ECS 서비스

api와 사양이 같다.
task role, 환경 변수, 시크릿은 없고 포트 3000을 사용한다.

| 항목 | 값 |
| --- | --- |
| 아키텍처 | ARM64 Fargate |
| cpu | 256 |
| memory | 512 |
| 포트 | 3000 |
| 헬스체크 | `/api/healthz` |
| 타깃 그룹 이름 | `jn-buddybird-bo-fe-<env>` |
| 역할 | execution role만 사용 |
| circuit breaker | 활성, 실패 시 자동 롤백 |

## 랜딩 사이트

### 사이트 버킷

| 항목 | 값 |
| --- | --- |
| 암호화 | SSE-S3 |
| public access | 차단 |
| 읽기 허용 | CloudFront만 `s3:GetObject` |
| 버킷 정책 | TLS 전용 |

### CloudFront

| behavior | 오리진 | 캐시 정책 |
| --- | --- | --- |
| 기본 | S3 | `Managed-CachingOptimized` |
| `/api/*` | Application Load Balancer(ALB) | - `Managed-CachingDisabled`<br>- `Managed-AllViewer` |

- 별칭: `buddybird.xyz`, `www.buddybird.xyz`
- OAC로 S3 접근
- 403 응답을 `/index.html`로 전환, 404 상태 코드 반환

#### rewrite 함수

- `www.` 요청을 루트 도메인으로 301 리다이렉트
- `/`로 끝나거나 확장자 없는 경로에 `index.html` 추가

### 배포 역할

GitHub Actions OIDC용으로 정의한 역할이다.

#### 신뢰 정책

- 이름: `jn-buddybird-site-deploy`
- `buddybird-landing` 레포, `ref:refs/heads/main`

#### 권한

| 대상 | 액션 |
| --- | --- |
| 사이트 버킷 | `s3:ListBucket` |
| 사이트 버킷 객체 | - `s3:PutObject`<br>- `s3:DeleteObject`<br>- `s3:GetObject` |
| CloudFront 배포 | `cloudfront:CreateInvalidation` |

## 리스너 규칙 우선순위

| 우선순위 | 호스트명 | 경로 |
| --- | --- | --- |
| 10 | `buddybird.xyz` | `/api/*` |
| 20 | `dev.buddybird.xyz` | `/api/*` |
| 30 | `backoffice.buddybird.xyz` | 전체 |
| 40 | `dev-backoffice.buddybird.xyz` | 전체 |

## DNS

Cloudflare CNAME 레코드, TTL 300초, proxied 비활성이다.

| 호스트명 | 대상 |
| --- | --- |
| `buddybird.xyz` | CloudFront |
| `www.buddybird.xyz` | CloudFront |
| `dev.buddybird.xyz` | ALB |
| `backoffice.buddybird.xyz` | ALB |
| `dev-backoffice.buddybird.xyz` | ALB |

## 삭제 보호

prod RDS에 `protect=True`와 `deletion_protection`을 적용한다.

## 배포

### 분담

api는 `buddybird-api` 레포의 GitHub Actions가 배포한다.
backoffice frontend는 사람이 로컬에서 빌드하고 배포한다.
이 스택에서 컨테이너 정의를 변경한 경우 `pulumi up` 후 서비스를 수동으로 갱신한다.

```bash
aws ecs update-service --cluster jn-cluster --service <서비스> \
  --task-definition <최신 revision> --force-new-deployment
```

### api 배포

| 브랜치 | 동작 |
| --- | --- |
| `dev` | - `pyproject.toml` 버전 태그가 ECR에 없어야 진행<br>- 이미지 빌드와 ECR 푸시<br>- 마이그레이션 task 실행<br>- dev 서비스 갱신 |
| `main` | - 같은 버전 태그가 ECR에 있어야 진행<br>- 마이그레이션 task 실행<br>- prod 서비스 갱신 |

### backoffice frontend 배포

1. ECR에 이미지 푸시
2. 실행 중인 리비전의 task definition을 복제해 새 이미지 태그로 등록
3. 서비스 갱신

빌드할 때 환경별 `NEXT_PUBLIC_API_URL`을 빌드 인자로 전달한다.

### 랜딩 사이트 배포

1. 사이트 버킷에 `aws s3 sync`
2. CloudFront invalidation

### 수동 단계

첫 적용 전에 스택 secret을 저장한다.

```bash
pulumi config set --secret cloudflare:apiToken <토큰>
pulumi config set --secret authAccessTokenKey "$(openssl rand -base64 32)"
pulumi config set --secret authRefreshTokenKey "$(openssl rand -base64 32)"
pulumi config set --secret backofficePassword <비밀번호>
```

### 최초 구축 순서

1. ECR 저장소와 배포 역할만 먼저 적용
2. api ECR에 `bootstrap` 태그로, backoffice frontend ECR에 `dev-bootstrap`과 `prod-bootstrap` 태그로 이미지 푸시
3. 나머지 리소스 적용
