# buddybird-app

buddybird 전용 인프라를 만든다.

| 파일 | 담당 |
| --- | --- |
| `__main__.py` | - 데이터 버킷<br>- 환경별 조립<br>- Domain Name System(DNS) 레코드<br>- 출력값 |
| `deploy.py` | - Elastic Container Registry(ECR) 저장소<br>- 배포 역할 |
| `data.py` | - Relational Database Service(RDS) 서브넷 그룹<br>- RDS 인스턴스<br>- 토큰 서명키 시크릿 |
| `service.py` | - 로그 그룹<br>- Identity and Access Management(IAM) 역할<br>- task definition<br>- 타깃 그룹<br>- 리스너 규칙<br>- Elastic Container Service(ECS) 서비스 |
| `edge.py` | - 사이트 버킷<br>- CloudFront<br>- Origin Access Control(OAC)<br>- rewrite 함수 |

`organization/joynnovate-infra/prod`의 출력값을 StackReference로 읽는다.

## 환경

`prod` 스택 하나에서 환경 생성 함수를 환경마다 호출한다.

| 환경 | 호스트명 | 진입 지점 |
| --- | --- | --- |
| prod | `buddybird.xyz` | CloudFront |
| dev | `dev.buddybird.xyz` | Application Load Balancer(ALB) 직접 연결 |

## 이름 규칙

계정이나 리전 단위로 이름이 유일해야 하는 리소스에 환경을 접미사로 추가한다.

| 리소스 | 이름 |
| --- | --- |
| - RDS<br>- ECS 서비스<br>- 타깃 그룹<br>- task definition family | `jn-buddybird-api-<env>` |
| task role | `jn-buddybird-api-<env>-task` |
| execution role | `jn-buddybird-api-<env>-exec` |
| 로그 그룹 | `/ecs/jn-buddybird-api-<env>` |
| 토큰 서명키 시크릿 | `jn-buddybird-api-<env>` |
| 데이터 버킷 | `jn-buddybird-v1-data-<env>-<계정>-<리전>` |

환경을 접미사로 추가하지 않는 리소스도 있다.

| 리소스 | 이름 | 이유 |
| --- | --- | --- |
| ECR 저장소 | `jn-buddybird-api` | 같은 digest를 dev에서 검증한 후 prod로 승격 |
| API 배포 역할 | `jn-buddybird-api-deploy` | 신뢰 정책에 환경별 `sub`를 포함해 한 역할이 모든 환경을 담당 |
| - 사이트 버킷<br>- 사이트 배포 역할 | `jn-buddybird-site-*` | 랜딩 사이트는 환경을 구분하지 않음 |

## deploy.py

| 리소스 | 구성 |
| --- | --- |
| ECR 저장소 | - 태그 IMMUTABLE<br>- 푸시 시 스캔<br>- 미태그 이미지 7일 후 만료<br>- 최근 20개만 보관 |
| `jn-buddybird-api-deploy` | - ECR 푸시<br>- ECS 서비스 갱신<br>- 마이그레이션 task 실행 |
| `jn-buddybird-site-deploy` | - 사이트 버킷 sync<br>- CloudFront invalidation |

OpenID Connect(OIDC) provider의 Amazon Resource Name(ARN)은 계정 ID로 조립한다.

```
arn:aws:iam::<계정>:oidc-provider/token.actions.githubusercontent.com
```

### 신뢰 정책 sub

| 역할 | 저장소 | `sub` 컨텍스트 |
| --- | --- | --- |
| `jn-buddybird-api-deploy` | `buddybird-api` | - `ref:refs/heads/main`<br>- `environment:prod` |
| `jn-buddybird-site-deploy` | `buddybird-landing` | `ref:refs/heads/main` |

### 배포 역할 권한

| 대상 | 액션 |
| --- | --- |
| `*` | - `ecr:GetAuthorizationToken`<br>- `ecs:RegisterTaskDefinition`<br>- `ecs:DescribeTaskDefinition` |
| ECR 저장소 | - 레이어 업로드<br>- `ecr:PutImage` |
| ECS 서비스 | - `ecs:UpdateService`<br>- `ecs:DescribeServices` |
| task definition | `ecs:RunTask` |
| task | - `ecs:DescribeTasks`<br>- `ecs:cluster` 조건 |
| `*-task`와 `*-exec` 역할 | - `iam:PassRole`<br>- `iam:PassedToService`를 `ecs-tasks.amazonaws.com`으로 한정 |
| 로그 그룹 | - `logs:GetLogEvents`<br>- `logs:DescribeLogStreams` |

## data.py

| 리소스 | 구성 |
| --- | --- |
| RDS 서브넷 그룹 | - private 서브넷<br>- 환경 공유 |
| RDS PostgreSQL 17 | - db.t4g.micro<br>- Availability Zone(AZ) 하나<br>- gp3 20GB<br>- 저장 암호화<br>- 백업 7일 |
| Secrets Manager 시크릿 | 토큰 서명키를 JSON 하나로 저장 |

RDS 비밀번호는 `manage_master_user_password`로 생성한다.

시크릿에 `recovery_window_in_days=0`을 설정한다.
값을 늘리면 샌드박스를 재구축할 때 같은 이름을 다시 사용할 수 없다.

## service.py

| 리소스 | 구성 |
| --- | --- |
| CloudWatch 로그 그룹 | 보존 30일 |
| execution role | - `AmazonECSTaskExecutionRolePolicy`<br>- 해당 환경 시크릿에 `secretsmanager:GetSecretValue` |
| task role | - 데이터 버킷 객체 읽기<br>- 데이터 버킷 객체 쓰기<br>- 데이터 버킷 객체 삭제 |
| task definition | - ARM64<br>- Fargate<br>- cpu 256<br>- memory 512<br>- awslogs |
| 타깃 그룹 | - 포트 8000<br>- 헬스 체크 `/api/healthz`<br>- `target_type=ip` |
| 리스너 규칙 | - 호스트명 조건<br>- 경로 조건 |
| ECS 서비스 | - public 서브넷<br>- `assign_public_ip` |

### 환경 변수

- `BUDDYBIRD_ENV`
- `DB_HOST`
- `DB_NAME`
- `DB_USER`
- `S3_BUCKET_NAME`
- `S3_BUCKET_DOMAIN`
- `AUTH_ALGORITHM`
- `AUTH_ACCESS_TOKEN_EXPIRE_MINUTES`
- `AUTH_REFRESH_TOKEN_EXPIRE_MINUTES`

### 시크릿

`secrets`로 주입하는 환경 변수는 다음과 같다.

- `DB_PASSWORD`
- `AUTH_ACCESS_TOKEN_SECRET_KEY`
- `AUTH_REFRESH_TOKEN_SECRET_KEY`

`valueFrom`은 JSON 키 선택자를 사용한다.

```
<RDS 관리 시크릿 ARN>:password::
<앱 시크릿 ARN>:access_token_key::
<앱 시크릿 ARN>:refresh_token_key::
```

### 리스너 규칙 priority

| priority | 호스트명 | 경로 |
| --- | --- | --- |
| 10 | `buddybird.xyz` | `/api/*` |
| 20 | `dev.buddybird.xyz` | `/api/*` |

## edge.py

| 리소스 | 구성 |
| --- | --- |
| 사이트 버킷 | - SSE-S3<br>- public access block<br>- BucketOwnerEnforced |
| OAC | Simple Storage Service(S3) 오리진용 |
| CloudFront Function | - viewer-request<br>- `www` 리다이렉트<br>- index 보정 |
| CloudFront 배포 | - 별칭 `buddybird.xyz`<br>- 별칭 `www.buddybird.xyz` |
| 버킷 정책 | - 사이트 배포에만 `s3:GetObject` 허용<br>- 비TLS 요청 거부 |

| behavior | 오리진 | 캐시 정책 |
| --- | --- | --- |
| `/api/*` | ALB | - `Managed-CachingDisabled`<br>- `Managed-AllViewer` |
| 기본 | S3 | `Managed-CachingOptimized` |

### rewrite 함수

rewrite 함수는 `/`로 끝나거나 확장자가 없는 경로에 `index.html`을 추가한다.
rewrite 함수를 제거하면 메인을 제외한 모든 페이지가 404를 응답한다.

### Host 전달

`/api/*` behavior에서 `Managed-AllViewer`를 제거하면 CloudFront가 502를 응답한다.

## DNS

| 이름 | 대상 |
| --- | --- |
| `buddybird.xyz` | CloudFront |
| `www.buddybird.xyz` | - CloudFront<br>- rewrite 함수가 루트 도메인으로 301 응답 |
| `dev.buddybird.xyz` | ALB |

## 삭제 보호

prod RDS에 `protect=True`와 `deletion_protection`을 적용한다.

## 배포 분담

이 프로젝트는 이미지 태그를 최초 1회만 지정한다.
새 버전 배포는 앱 저장소의 워크플로가 `jn-buddybird-api-deploy`를 assume해 담당한다.

```python
opts=pulumi.ResourceOptions(ignore_changes=["taskDefinition", "desiredCount"])
```

`ignore_changes` 때문에 Pulumi가 task definition을 새 revision으로 변경해도 ECS 서비스는 이전 revision을 사용한다.
이 프로젝트에서 컨테이너 정의를 변경했다면 적용 후 사람이 서비스를 갱신한다.

```bash
aws ecs update-service --cluster jn-cluster --service <서비스> \
  --task-definition <최신 revision> --force-new-deployment
```

## 최초 구축 순서

1. ECR 저장소와 배포 역할만 적용
2. 사람이 Single Sign-On(SSO) 자격으로 이미지를 `bootstrap` 태그로 푸시
3. 나머지 리소스 적용
4. 마이그레이션 task 실행
5. 사이트 버킷에 랜딩 사이트 파일 업로드

## 수동 단계

첫 적용 전에 스택 secret을 저장한다.

```bash
pulumi config set --secret cloudflare:apiToken <토큰>
pulumi config set --secret authAccessTokenKey "$(openssl rand -base64 32)"
pulumi config set --secret authRefreshTokenKey "$(openssl rand -base64 32)"
```
