# buddybird-app

buddybird 서비스의 인프라를 만드는 프로젝트다.

`joynnovate-infra`가 만든 네트워크와 클러스터, ALB 위에 올라간다.

## 코드 구성

| 파일 | 담당 |
| --- | --- |
| `__main__.py` | StackReference로 상위 스택 값 조회, S3 버킷 생성, 서비스 조립, 출력값 export |
| `data.py` | RDS, ElastiCache |
| `service.py` | ECS 서비스 ComponentResource |
| `edge.py` | CloudFront와 OAC, 사이트 DNS 레코드 |

## 상위 스택 참조

`joynnovate-infra`의 `prod` 스택을 StackReference로 읽는다.

```
organization/joynnovate-infra/prod
```

| 읽는 값 | 사용처 |
| --- | --- |
| `vpc_id` | 타깃 그룹 |
| `public_subnet_ids` | ECS 서비스의 네트워크 설정 |
| `private_subnet_ids` | RDS 서브넷 그룹 |
| `task_security_group_id` | ECS 서비스의 네트워크 설정 |
| `db_security_group_id` | RDS 인스턴스 |
| `cache_security_group_id` | ElastiCache Serverless 캐시 |
| `cluster_arn` | ECS 서비스 |
| `alb_dns_name` | 서비스 호스트명의 Cloudflare CNAME |
| `https_listener_arn` | 리스너 규칙 |
| `cloudfront_certificate_arn` | CloudFront 배포 |

이 참조 때문에 `joynnovate-infra`를 먼저 적용해야 한다.

## 생성 리소스

### `data.py`

| 리소스 | 구성 |
| --- | --- |
| RDS PostgreSQL | db.t4g.small, single-AZ, gp3, private 서브넷 |
| ElastiCache Serverless | Valkey 엔진, private 서브넷 |
| ElastiCache user | 앱이 사용하는 RBAC 계정 |
| ElastiCache user group | 캐시에 연결하는 user 묶음 |

RDS 비밀번호는 `manage_master_user_password`로 생성해 Secrets Manager에 저장한다.

캐시 비밀번호는 `random.RandomPassword`로 생성해 Secrets Manager에 저장하고, ECS task에 환경 변수로 주입한다.

### `service.py`

ECS 서비스 하나를 만드는 데 필요한 리소스를 ComponentResource 한 클래스로 묶는다.

| 리소스 | 구성 |
| --- | --- |
| ECR 저장소 | 서비스별 컨테이너 이미지 저장 |
| CloudWatch 로그 그룹 | 보존 기간 지정 |
| task execution role | ECR pull, 로그 기록, Secrets Manager 조회 |
| task role | 앱이 사용하는 AWS 리소스 접근 |
| task definition | ARM64, Fargate |
| 타깃 그룹 | 서비스 포트와 헬스 체크 경로 지정 |
| 리스너 규칙 | 호스트명으로 타깃 그룹 선택 |
| ECS 서비스 | 클러스터에 배치, 타깃 그룹에 등록, `assign_public_ip` 활성화 |
| Cloudflare DNS 레코드 | 서비스 호스트명을 ALB로 보내는 CNAME, 프록시 미사용 |

task는 public 서브넷에 뜨므로 public IP가 있어야 ECR에서 이미지를 받는다.
`assign_public_ip`를 켜지 않으면 이미지를 받지 못해 task가 기동에 실패한다.

리스너 규칙의 priority는 지정하지 않는다.

### `edge.py`

| 리소스 | 구성 |
| --- | --- |
| CloudFront 배포 | 정적 사이트 버킷과 앱 데이터 버킷을 오리진으로 사용 |
| OAC | 두 오리진 모두에 적용 |
| Cloudflare DNS 레코드 | CloudFront 배포를 가리키는 CNAME, 프록시 미사용 |

인증서는 `joynnovate-infra`가 us-east-1에서 발급한 것을 참조한다.

루트 도메인에도 CNAME을 두고 Cloudflare의 CNAME flattening이 IP로 응답한다.

### `__main__.py`

| 리소스 | 구성 |
| --- | --- |
| S3 버킷 | v1 오디오 수집 개발용 |
| S3 버킷 | v1 오디오 수집 로컬 개발용 |

버킷 이름은 `jn-buddybird-v1-data-<환경>-<계정 ID>-<리전>` 형식이다.

v1 수집 버킷은 v2 운영을 시작한 뒤 데이터를 옮기고 삭제한다.
두 버전의 버킷이 한동안 함께 있어야 해서 이름에 버전을 넣는다.

두 버킷 모두 SSE-S3 암호화와 public access block, BucketOwnerEnforced를 적용하고 미완료 멀티파트 업로드를 시작 후 7일에 중단한다.
버킷 정책은 `aws:SecureTransport`가 false인 요청을 거부한다.

개발 중 올리는 테스트 오디오만 들어가므로 버저닝과 객체 만료 규칙은 걸지 않는다.

운영 수집 버킷은 아직 만들지 않았다.
만들 때 `capture/` prefix에 180일 만료를 걸고 `word/` prefix는 만료 없이 둔다.

정적 사이트 버킷도 아직 만들지 않았다.
이름은 `jn-buddybird-site-<계정 ID>-<리전>`으로 두고 환경을 나누지 않는다.

## 서비스 컴포넌트

서비스 컴포넌트는 두 번 사용한다.

| 서비스 | 앱 저장소 | 포트 | 헬스 체크 경로 |
| --- | --- | --- | --- |
| api | `buddybird-api` | 8000 | `/api/healthz` |
| mbti-web | `buddybird-mbti-web` | 3000 | `/api/healthz/` |

`buddybird-landing`은 정적 HTML이므로 ECS 서비스를 만들지 않고 정적 사이트 버킷에 배포한다.

## 삭제 보호

다음 리소스에는 `protect=True`를 걸어 `pulumi destroy`로 삭제되지 않게 한다.

- RDS 인스턴스
- 앱 데이터 버킷

정말 삭제해야 하면 `protect`를 제거하고 적용한 뒤 destroy를 실행한다.

## ECS 배포 분담

이 프로젝트는 ECS 서비스의 골격만 만든다.

이미지 태그는 최초 1회만 지정한다.

새 버전 배포는 앱 저장소의 워크플로가 담당한다.

앱 저장소는 `jn-ci-deploy` 역할을 assume해 이미지를 ECR에 올리고, 새 task definition revision을 등록해 서비스를 갱신한다.

두 주체가 같은 값을 건드리지 않도록 ECS 서비스에 `ignoreChanges`를 적용한다.

```python
opts=pulumi.ResourceOptions(ignore_changes=["taskDefinition"])
```

`ignoreChanges`는 속성 경로 단위로 동작한다.

타깃 그룹 연결과 네트워크 설정 변경은 Pulumi가 그대로 반영한다.

적용할 때는 `pulumi up --refresh`를 사용한다.

refresh를 건너뛰면 Pulumi가 state에 남은 기존 revision을 다시 보내 앱 배포가 되돌아간다.

## 수동 단계

첫 적용 전에 Cloudflare API 토큰을 스택 secret으로 넣는다.

```bash
pulumi config set --secret cloudflare:apiToken <토큰>
```

토큰에는 대상 zone의 DNS 편집 권한을 준다.

DNS 레코드 등록은 코드가 담당하므로 사람이 Cloudflare 대시보드를 여는 단계는 없다.
