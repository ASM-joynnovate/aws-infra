# joynnovate-infra

계정 전체가 공유하는 인프라를 만드는 프로젝트다.
네트워크와 ECS 클러스터, ALB, ACM 인증서, 로그 버킷, 예산 알림이 여기에 속한다.
제품이 늘어나면 제품별 프로젝트를 추가하고 이 리소스를 함께 사용한다.

용어는 [README](../README.md)의 용어 표를 참고한다.

## 코드 구성

| 파일 | 담당 |
| --- | --- |
| `__main__.py` | 두 컴포넌트 조립, 로그 버킷과 AWS Budgets 생성, 출력값 export |
| `network.py` | `Network` 컴포넌트, VPC와 서브넷, 라우트 테이블, S3 gateway endpoint, 보안 그룹, flow log |
| `serving.py` | `Serving` 컴포넌트, ECS 클러스터, ACM 인증서와 검증 레코드, ALB와 리스너 |

두 모듈은 ComponentResource 한 클래스로 리소스를 묶고 `__main__.py`가 필요한 리소스를 속성으로 읽는다.
`buddybird-app`의 `service.py`도 같은 방식을 사용한다.

## 생성 리소스

### `network.py`

| 리소스 | 구성 |
| --- | --- |
| VPC | DNS 지원과 DNS 호스트명 활성화 |
| 인터넷 게이트웨이 | VPC에 연결 |
| public 서브넷 | AZ 2개에 각 1개 |
| private 서브넷 | AZ 2개에 각 1개 |
| 라우트 테이블 | public용 1개, private용 1개 |
| S3 gateway endpoint | 두 라우트 테이블에 연결 |
| 보안 그룹 | ALB용, ECS task용, RDS용, 캐시용 |
| 기본 보안 그룹 | 규칙을 모두 제거하고 이름에 미사용 표시 |
| VPC flow log | 전체 트래픽을 기록해 로그 버킷으로 전달 |

### `serving.py`

| 리소스 | 구성 |
| --- | --- |
| ECS 클러스터 | Fargate 사용 |
| ACM 인증서 | ALB용, ap-northeast-2에서 발급 |
| ACM 인증서 | CloudFront용, us-east-1에서 발급 |
| Cloudflare DNS 레코드 | 두 인증서가 함께 쓰는 검증 CNAME 하나, 프록시 미사용 |
| ALB | public 서브넷에 배치, access log를 로그 버킷으로 전달 |
| 리스너 | 443, ALB용 인증서 연결 |
| 리스너 | 80, 443으로 리다이렉트 |

호스트 기반 라우팅 규칙과 타깃 그룹은 `buddybird-app`이 만든다.
443 리스너는 규칙에 걸리지 않은 요청에 404를 반환하는 기본 동작만 가진다.

443 리스너의 보안 정책은 `ELBSecurityPolicy-TLS13-1-2-2021-06`으로 지정해 TLS 1.2와 1.3만 허용한다.
지정하지 않으면 기본 정책이 TLS 1.0과 1.1까지 허용한다.

리스너 규칙의 priority는 지정하지 않는다.
생략하면 현재 가장 높은 값 다음 번호가 자동으로 배정되므로 제품이 늘어나도 번호를 조정하지 않는다.

us-east-1 인증서는 리전이 다르므로 `aws.Provider` 인스턴스를 따로 만들어 전달한다.

두 인증서 모두 루트 도메인과 와일드카드를 함께 담는다.

검증 CNAME은 인증서의 `domainValidationOptions`에서 읽어 Cloudflare에 만들고, 같은 적용 안에서 검증이 끝난다.
검증 레코드를 Cloudflare 프록시에 태우면 ACM이 값을 읽지 못하므로 프록시는 끈다.

ACM은 와일드카드와 그 루트 도메인에 같은 검증 CNAME을 발급하고, 이 토큰은 리전이 달라도 그대로 동작한다.
그래서 네 개의 `domainValidationOptions`가 모두 같은 값이고 Cloudflare 레코드는 하나만 만들어 두 인증서가 함께 사용한다.

### `__main__.py`

| 리소스 | 구성 |
| --- | --- |
| 로그 버킷 | ALB access log와 VPC flow log 저장 |
| AWS Budgets | 월 단위 비용 예산, 실제 지출 기준 알림 |

로그 버킷은 두 모듈이 함께 사용하므로 `__main__.py`가 만들어 각 모듈에 전달한다.

ALB access log는 SSE-S3로 암호화한 버킷에만 쌓을 수 있어 KMS 키는 사용하지 않는다.
버킷 정책은 `logdelivery.elasticloadbalancing.amazonaws.com`에 ALB prefix 하위 쓰기를 허용한다.

flow log를 만들면 AWS가 `delivery.logs.amazonaws.com` 권한을 버킷 정책에 직접 써넣으면서 기존 정책을 덮어쓴다.
정책이 버킷 전체를 이미 허용하고 있으면 AWS가 정책을 건드리지 않으므로, flow log 쓰기 권한의 대상은 prefix가 아니라 버킷 전체로 준다.
이렇게 해야 ALB access log 권한이 지워지지 않는다.

두 로그는 prefix로 나누고 30일 뒤 삭제한다.
flow log를 CloudWatch Logs로 보내면 GB당 수집 비용이 두 배라서 S3로 보낸다.

샌드박스가 예산 한도에서 리소스를 정지시키므로 알림 금액을 한도보다 낮게 잡는다.

알림은 한도의 50, 75, 90퍼센트에서 각각 보내고 팀 이메일로 받는다.
실제 지출 알림은 임계값을 처음 넘을 때 한 번만 오기 때문에 여러 단으로 나눈다.

예측 기반 알림은 사용 이력이 약 5주치 쌓여야 발동하므로 사용하지 않는다.

## 네트워크

ECS task는 public 서브넷에 두고 보안 그룹으로 접근을 제한한다.
RDS는 private 서브넷에 둔다.

보안 그룹의 인바운드는 다음만 허용한다.

| 보안 그룹 | 인바운드 허용 |
| --- | --- |
| ALB용 | 인터넷에서 오는 80과 443 |
| ECS task용 | ALB 보안 그룹에서 오는 모든 트래픽 |
| RDS용 | ECS task 보안 그룹에서 오는 5432 |
| 캐시용 | ECS task 보안 그룹에서 오는 6379와 6380 |

보안 그룹 규칙의 `description`은 영문으로 적는다.
EC2가 `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*` 밖의 문자를 거부하므로 한글을 넣으면 규칙 생성이 `InvalidParameterValue`로 실패한다.
보안 그룹 자체의 `description`에는 이 제약이 없지만 함께 영문으로 맞춘다.

task 보안 그룹은 서비스보다 먼저 만들어져 제품별 포트를 알 수 없으므로 포트를 좁히지 않고 출발지만 ALB 보안 그룹으로 제한한다.
AWS Copilot의 환경 보안 그룹도 같은 방식으로 ALB 보안 그룹에서 오는 모든 프로토콜을 허용한다.

task에 public IP가 붙으므로 task 보안 그룹에는 인터넷에서 오는 인바운드를 열지 않는다.

ElastiCache Serverless는 쓰기 엔드포인트가 6379, 읽기 엔드포인트가 6380이고 클라이언트가 두 포트에 모두 연결하므로 둘 다 연다.

NAT Gateway는 만들지 않는다.
S3 통신은 gateway endpoint를 거친다.

## 출력값

`buddybird-app`이 StackReference로 읽는 값이다.

| 출력값 | 사용처 |
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

출력값은 다른 스택이 사용하는 것만 export한다.

StackReference는 값을 읽기만 하므로 `buddybird-app`이 참조 중이어도 이 프로젝트의 destroy를 막지 않는다.
destroy한 뒤에는 `buddybird-app`도 다시 적용해야 한다.

## 수동 단계

첫 적용 전에 Cloudflare API 토큰을 스택 secret으로 넣는다.

```bash
pulumi config set --secret cloudflare:apiToken <토큰>
```

토큰에는 대상 zone의 DNS 편집 권한을 준다.

DNS 레코드 등록은 코드가 담당하므로 사람이 Cloudflare 대시보드를 여는 단계는 없다.
