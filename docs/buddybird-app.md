# buddybird-app

buddybird 전용 RDS, ECS 서비스, 배포 역할 구성

| 항목 | 값 |
|---|---|
| StackReference | `organization/joynnovate-infra/prod` |

## 파일 구성

| 파일 | 역할 |
|---|---|
| `__main__.py` | 데이터 버킷, 환경별 구성, DNS 레코드, 출력값 |
| `deploy.py` | ECR 저장소, 배포 역할, rotation 재배포 Lambda |
| `data.py` | RDS 서브넷 그룹, RDS 인스턴스, 앱 시크릿, DB readonly 시크릿 |
| `service.py` | 로그 그룹, IAM 역할, task definition, 타깃 그룹, 리스너 규칙, ECS 서비스 |
| `edge.py` | 랜딩 페이지 버킷, CloudFront, OAC, rewrite 함수 |

## 환경

| 환경 | api 호스트명 | backoffice frontend 호스트명 |
|---|---|---|
| prod | `buddybird.xyz` | `backoffice.buddybird.xyz` |
| dev | `dev.buddybird.xyz` | `dev-backoffice.buddybird.xyz` |

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
| 데이터 버킷 | `jn-buddybird-v1-data-<env>-<계정>-<리전>` |
| backoffice frontend: ECS 서비스, task definition | `jn-buddybird-backoffice-frontend-<env>` |
| backoffice frontend: 타깃 그룹 | `jn-buddybird-bo-fe-<env>` |
| backoffice frontend: execution role | `jn-buddybird-backoffice-frontend-<env>-exec` |
| backoffice frontend: 로그 그룹 | `/ecs/jn-buddybird-backoffice-frontend-<env>` |

### 공통 이름

| 리소스 | 이름 |
|---|---|
| api ECR 저장소 | `jn-buddybird-api` |
| api 배포 역할 | `jn-buddybird-api-deploy` |
| backoffice frontend ECR 저장소 | `jn-buddybird-backoffice-frontend` |
| backoffice frontend 배포 역할 | `jn-buddybird-backoffice-frontend-deploy` |
| 랜딩 페이지 버킷 | `jn-buddybird-site-<계정>-<리전>` |
| 랜딩 페이지 배포 역할 | `jn-buddybird-site-deploy` |

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
| prod 삭제 보호 | `protect=True`, `deletion_protection` |

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
| `access_token_key` | 액세스 토큰 서명 |
| `refresh_token_key` | 리프레시 토큰 서명 |
| `backoffice_password` | backoffice 로그인 |

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
| 미완료 멀티파트 업로드 | 7일 후 삭제 |

#### CORS

| 환경 | 허용 출처 |
|---|---|
| dev | `https://dev.buddybird.xyz`, `https://dev-backoffice.buddybird.xyz` |
| prod | `https://buddybird.xyz`, `https://backoffice.buddybird.xyz` |
| local | `http://localhost:3000` |

### ECS 서비스

| 항목 | 값 |
|---|---|
| 아키텍처 | ARM64 Fargate |
| cpu | 256 |
| memory | 512 |
| 포트 | 8000 |
| 헬스체크 | `/api/healthz` |
| 서브넷 | public, `assign_public_ip` |
| circuit breaker | 활성화, 실패 시 자동 롤백 |

### 환경 변수

| 변수 | 값 |
|---|---|
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

| 변수 | `valueFrom` |
|---|---|
| `DB_PASSWORD` | `<RDS 관리 시크릿 ARN>:password::` |
| `AUTH_ACCESS_TOKEN_SECRET_KEY` | `<앱 시크릿 ARN>:access_token_key::` |
| `AUTH_REFRESH_TOKEN_SECRET_KEY` | `<앱 시크릿 ARN>:refresh_token_key::` |
| `BACKOFFICE_PASSWORD` | `<앱 시크릿 ARN>:backoffice_password::` |

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
  - `ref:refs/heads/dev`

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
| 헬스체크 | `/api/healthz` |
| 타깃 그룹 이름 | `jn-buddybird-bo-fe-<env>` |
| 역할 | execution role만 사용 |
| circuit breaker | 활성화, 실패 시 자동 롤백 |
| task role | X |
| 환경 변수 | X |
| 시크릿 | X |

## 랜딩 페이지

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
| `/api/*` | ALB | `Managed-CachingDisabled`, `Managed-AllViewer` |

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
| 랜딩 페이지 버킷 | `s3:ListBucket` |
| 랜딩 페이지 버킷 객체 | `s3:PutObject`, `s3:DeleteObject`, `s3:GetObject` |
| CloudFront 배포 | `cloudfront:CreateInvalidation` |

## 리스너 규칙 우선순위

| 우선순위 | 호스트명 | 경로 |
|---|---|---|
| 10 | `buddybird.xyz` | `/api/*` |
| 20 | `dev.buddybird.xyz` | `/api/*` |
| 30 | `backoffice.buddybird.xyz` | 전체 |
| 40 | `dev-backoffice.buddybird.xyz` | 전체 |

## DNS

| 호스트명 | 대상 | TTL | proxied |
|---|---|---|---|
| `buddybird.xyz` | CloudFront | 300초 | 비활성 |
| `www.buddybird.xyz` | CloudFront | 300초 | 비활성 |
| `dev.buddybird.xyz` | ALB | 300초 | 비활성 |
| `backoffice.buddybird.xyz` | ALB | 300초 | 비활성 |
| `dev-backoffice.buddybird.xyz` | ALB | 300초 | 비활성 |

## 배포

### 분담

| 서비스 | 배포 레포 |
|---|---|
| api | `buddybird-api` GitHub Actions |
| backoffice frontend | `buddybird-backoffice-frontend` GitHub Actions |
| 랜딩 페이지 | `buddybird-landing` GitHub Actions |

이 스택에서 컨테이너 정의를 변경한 경우 `pulumi up` 후 서비스를 수동으로 갱신합니다.

```bash
aws ecs update-service --cluster jn-cluster --service <서비스> \
  --task-definition <최신 revision> --force-new-deployment
```

### api 배포

| 브랜치 | 동작 |
|---|---|
| `dev` | 이미지 빌드와 ECR 푸시 → 마이그레이션 task 실행 → dev 서비스 갱신 |
| `main` | 마이그레이션 task 실행 → prod 서비스 갱신 |

### backoffice frontend 배포

| 트리거 | 동작 |
|---|---|
| release-please 릴리즈 PR 머지(dev) | 이미지 빌드와 ECR 푸시 → dev 서비스 갱신 |
| push to main | prod 서비스 갱신 |

### 수동 단계

첫 적용 전에 스택 secret을 저장합니다.

```bash
pulumi config set --secret cloudflare:apiToken <토큰>
pulumi config set --secret authAccessTokenKey "$(openssl rand -base64 32)"
pulumi config set --secret authRefreshTokenKey "$(openssl rand -base64 32)"
pulumi config set --secret backofficePassword <비밀번호>
pulumi config set --secret readonlyDbPassword <비밀번호>
```

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

1. ECR 저장소와 배포 역할만 먼저 적용
2. api ECR에 `bootstrap` 태그로, backoffice frontend ECR에 `dev-bootstrap`과 `prod-bootstrap` 태그로 이미지 푸시
3. 나머지 리소스 적용
