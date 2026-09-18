# buddybird-app

buddybird 전용 RDS, ECS 서비스, CloudFront 구성

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
| `service.py` | `Api`, `WebService` 컴포넌트, 로그 그룹과 실행 역할과 Fargate 서비스 헬퍼 |
| `edge.py` | `Landing`, `MbtiCdn` 컴포넌트 |
| `oidc.py` | GitHub OIDC 신뢰 정책 |
| `dns.py` | Cloudflare CNAME 레코드 |
| `moved.py` | 컴포넌트 이전에 사용하는 aliases 헬퍼, 이전 완료 후 삭제 |

## 리소스 구성

모든 리소스는 컴포넌트 아래에 있습니다.
컴포넌트는 `(name, args, opts)` 생성자와 `@dataclass` Args를 사용하고 자식 논리 이름에 컴포넌트 이름을 접두어로 붙입니다.
`Api`는 `DataBucket`과 `Database`를 자식 컴포넌트로 갖습니다.

| 컴포넌트 | 이름 | 리소스 |
|---|---|---|
컴포넌트 이름에는 스택 이름이 붙습니다.

| 컴포넌트 | 이름 | 스택 | 리소스 |
|---|---|---|---|
| `Api` | `api-<스택>` | `dev`, `prod` | 앱 시크릿, 실행 역할과 task 역할, 로그 그룹, task definition, 타깃 그룹, 리스너 규칙, ECS 서비스, rotation 재배포 Lambda, 랜딩이 없는 스택의 DNS |
| `DataBucket` | `api-<스택>-data` | `dev`, `prod` | 데이터 버킷과 하드닝, 버저닝, 라이프사이클, TLS 전용 정책, CORS |
| `DataBucket` | `api-dev-local-data` | `dev` | 로컬 개발용 데이터 버킷 |
| `Database` | `api-<스택>-database` | `dev`, `prod` | RDS 인스턴스, readonly 시크릿 |
| `WebService` | `backoffice-frontend-<스택>` | `dev`, `prod` | 로그 그룹, 실행 역할, task definition, 타깃 그룹, 리스너 규칙, ECS 서비스, DNS |
| `WebService` | `mbti-web-prod` | `prod` | backoffice frontend와 같음 |
| `MbtiCdn` | `mbti-cdn-prod` | `prod` | 이미지 캐시 정책, CloudFront |
| `Landing` | `landing-prod` | `prod` | 랜딩 버킷과 하드닝, OAC, rewrite 함수, CloudFront, 버킷 정책, 배포 역할과 정책, DNS `root`와 `www` |

## 환경

환경마다 스택을 둡니다.
스택 이름이 환경 이름이고 코드는 `pulumi.get_stack()`으로 환경을 읽습니다.

| 스택 | api 호스트명 | backoffice frontend 호스트명 | mbti web 호스트명 | 랜딩 |
|---|---|---|---|---|
| `prod` | `buddybird.xyz` | `backoffice.buddybird.xyz` | `mbti.buddybird.xyz` | O |
| `dev` | `dev.buddybird.xyz` | `dev-backoffice.buddybird.xyz` | X | X |

### 스택 config

스택마다 다른 값은 `Pulumi.<스택>.yaml`에 둡니다.
도메인과 이름 접두사는 Python 상수입니다.

| 키 | 값 | 필수 |
|---|---|---|
| `api` | `subdomain`, `priority`. `subdomain`이 없으면 루트 도메인 | O |
| `backofficeFrontend` | `subdomain`, `priority` | O |
| `mbtiWeb` | `subdomain`, `priority`. 키가 있는 스택에만 mbti web과 MBTI CloudFront 생성 | X |
| `landing` | `true`인 스택에만 랜딩 생성 | X |
| `localDataBucket` | `true`인 스택에 로컬 개발용 데이터 버킷 생성 | X |
| `dbDeletionProtection` | `true`이면 RDS 삭제 보호와 최종 스냅샷 사용 | X |
| `mbtiCdnEnabled` | `true`이면 mbti DNS를 MBTI CloudFront로 연결 | X |

데이터 버킷의 CORS origin은 api와 backoffice frontend의 호스트명에서 계산합니다.
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
| 데이터 버킷 | `jn-buddybird-v1-data-<env>-<계정>-<리전>` |
| backoffice frontend: ECS 서비스, task definition | `jn-buddybird-backoffice-frontend-<env>` |
| backoffice frontend: 타깃 그룹 | `jn-buddybird-bo-fe-<env>` |
| backoffice frontend: execution role | `jn-buddybird-backoffice-frontend-<env>-exec` |
| backoffice frontend: 로그 그룹 | `/ecs/jn-buddybird-backoffice-frontend-<env>` |
| mbti web: ECS 서비스, task definition, 타깃 그룹 | `jn-buddybird-mbti-prod` |
| mbti web: execution role | `jn-buddybird-mbti-prod-exec` |
| mbti web: 로그 그룹 | `/ecs/jn-buddybird-mbti-prod` |

### 공통 이름

| 리소스 | 이름 | 소유 프로젝트 |
|---|---|---|
| api ECR 저장소 | `jn-buddybird-api` | `buddybird-shared` |
| api 배포 역할 | `jn-buddybird-api-deploy` | `buddybird-shared` |
| backoffice frontend ECR 저장소 | `jn-buddybird-backoffice-frontend` | `buddybird-shared` |
| backoffice frontend 배포 역할 | `jn-buddybird-backoffice-frontend-deploy` | `buddybird-shared` |
| mbti web ECR 저장소 | `jn-buddybird-mbti` | `buddybird-shared` |
| mbti web 배포 역할 | `jn-buddybird-mbti-deploy` | `buddybird-shared` |
| RDS 서브넷 그룹 | `jn-buddybird-api` | `buddybird-shared` |
| 랜딩 페이지 버킷 | `jn-buddybird-site-<계정>-<리전>` | `buddybird-app` |
| 랜딩 페이지 배포 역할 | `jn-buddybird-site-deploy` | `buddybird-app` |

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
| 헬스체크 | `/api/healthz` |
| 타깃 그룹 이름 | `jn-buddybird-mbti-prod` |
| 역할 | execution role만 사용 |
| circuit breaker | 활성화, 실패 시 자동 롤백 |
| task role | X |
| 환경 변수 | X |
| 시크릿 | X |

### MBTI CloudFront

첫 접속의 이미지 변환 결과를 공유하고 ECS task 교체 후에도 캐시를 재사용하는 전용 distribution입니다.
Origin은 기존 ALB이며, 모든 경로에서 `Host`를 전달하고 HTTPS로 연결합니다.
랜딩 페이지의 rewrite 함수와 오류 페이지 치환은 사용하지 않습니다.

| 경로 | 캐시 | Origin request policy |
|---|---|---|
| `/_next/image` | `url`, `w`, `q`, `Accept`별 캐시, 쿠키 제외 | `HostHeaderOnly` |
| `/_next/static/*` | `CachingOptimized`, 압축 활성화 | `HostHeaderOnly` |
| 그 외: HTML, RSC, API, 원본 PNG | `CachingDisabled` | `AllViewer` |

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

두 스택이 `infra`의 HTTPS 리스너 하나를 함께 사용합니다.
우선순위는 리스너 안에서 고유해야 하므로 스택 config에 값을 추가할 때 이 표에서 겹치지 않는 값을 고릅니다.

| 우선순위 | 스택 | 호스트명 | 경로 |
|---|---|---|---|
| 10 | `prod` | `buddybird.xyz` | `/api/*` |
| 20 | `dev` | `dev.buddybird.xyz` | `/api/*` |
| 30 | `prod` | `backoffice.buddybird.xyz` | 전체 |
| 40 | `dev` | `dev-backoffice.buddybird.xyz` | 전체 |
| 50 | `prod` | `mbti.buddybird.xyz` | 전체 |

## DNS

| 호스트명 | 스택 | 소유 컴포넌트 | 대상 | TTL | proxied |
|---|---|---|---|---|---|
| `buddybird.xyz` | `prod` | `Landing` | CloudFront | 300초 | 비활성 |
| `www.buddybird.xyz` | `prod` | `Landing` | CloudFront | 300초 | 비활성 |
| `dev.buddybird.xyz` | `dev` | `Api` | ALB | 300초 | 비활성 |
| `backoffice.buddybird.xyz` | `prod` | `WebService` | ALB | 300초 | 비활성 |
| `dev-backoffice.buddybird.xyz` | `dev` | `WebService` | ALB | 300초 | 비활성 |
| `mbti.buddybird.xyz` | `prod` | `WebService` | `mbtiCdnEnabled=true`: MBTI CloudFront, 기본값: ALB | 300초 | 비활성 |

## 배포

### 분담

| 서비스 | 배포 레포 |
|---|---|
| api | `buddybird-api` GitHub Actions |
| backoffice frontend | `buddybird-backoffice-frontend` GitHub Actions |
| mbti web | `buddybird-mbti-web` GitHub Actions |
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

### mbti web 배포

| 트리거 | 동작 |
|---|---|
| release-please 릴리즈 PR merge | 이미지 빌드와 ECR push 후 prod 서비스 갱신 |

### 수동 단계

첫 적용 전에 스택마다 secret을 저장합니다.

```bash
pulumi config set --stack <스택> --secret cloudflare:apiToken <토큰>
pulumi config set --stack <스택> --secret authAccessTokenKey "$(openssl rand -base64 32)"
pulumi config set --stack <스택> --secret authRefreshTokenKey "$(openssl rand -base64 32)"
pulumi config set --stack <스택> --secret backofficePassword <비밀번호>
pulumi config set --stack <스택> --secret readonlyDbPassword <비밀번호>
```

`authAccessTokenKey`와 `authRefreshTokenKey`는 스택마다 다른 값으로 설정합니다.
JWT 서명 키가 같으면 dev에서 발급한 토큰이 prod에서도 유효합니다.
`backofficePassword`와 `readonlyDbPassword`는 현재 `dev`와 `prod` 스택이 같은 값을 사용합니다.

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
2. api ECR에 `bootstrap` 태그로, backoffice frontend ECR에 `dev-bootstrap`과 `prod-bootstrap` 태그로, mbti web ECR에 `prod-bootstrap` 태그로 이미지 푸시
3. `buddybird-app` 적용
