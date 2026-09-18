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
| `deploy.py` | `ImageDelivery` 컴포넌트 |
| `data.py` | `DbNetwork` 컴포넌트 |
| `oidc.py` | GitHub OIDC 신뢰 정책 |

## 리소스 구성

모든 리소스는 컴포넌트 아래에 있습니다.
컴포넌트는 `(name, args, opts)` 생성자와 `@dataclass` Args를 사용하고 자식 논리 이름에 컴포넌트 이름을 접두어로 붙입니다.

| 컴포넌트 | 이름 | 리소스 |
|---|---|---|
| `ImageDelivery` | `api`, `backoffice-frontend`, `mbti-web` | ECR 저장소, 라이프사이클 정책, 배포 역할과 정책 |
| `DbNetwork` | `db-network` | RDS 서브넷 그룹 |

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
| `db_subnet_group_name` | RDS 인스턴스 |
| `api_deploy_role_arn` | `buddybird-api` 레포지토리의 GitHub Actions |
| `backoffice_frontend_deploy_role_arn` | `buddybird-backoffice-frontend` 레포지토리의 GitHub Actions |
| `mbti_web_deploy_role_arn` | `buddybird-mbti-web` 레포지토리의 GitHub Actions |
