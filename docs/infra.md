# joynnovate-infra

계정 전체가 공유하는 인프라를 만드는 프로젝트다.
네트워크와 ECS 클러스터, ALB, ACM 인증서, 예산 알림이 여기에 속한다.
제품이 늘어나도 이 프로젝트는 그대로 두고 제품별 프로젝트만 추가한다.

용어는 [README](../README.md)의 용어 표를 참고한다.

## 코드 구성

| 파일 | 담당 |
| --- | --- |
| `__main__.py` | 두 모듈 조립, AWS Budgets 생성, 출력값 export |
| `network.py` | VPC, 서브넷, 라우트 테이블, S3 gateway endpoint, 보안 그룹 |
| `serving.py` | ECS 클러스터, ACM 인증서, ALB와 리스너 |

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

### `serving.py`

| 리소스 | 구성 |
| --- | --- |
| ECS 클러스터 | Fargate 사용 |
| ACM 인증서 | ALB용, ap-northeast-2에서 발급 |
| ACM 인증서 | CloudFront용, us-east-1에서 발급 |
| ALB | public 서브넷에 배치 |
| 리스너 | 443, ALB용 인증서 연결 |
| 리스너 | 80, 443으로 리다이렉트 |

호스트 기반 라우팅 규칙과 타깃 그룹은 `buddybird-app`이 만든다.
443 리스너는 규칙에 걸리지 않은 요청에 404를 반환하는 기본 동작만 가진다.

us-east-1 인증서는 리전이 다르므로 `aws.Provider` 인스턴스를 따로 만들어 전달한다.

### `__main__.py`

| 리소스 | 구성 |
| --- | --- |
| AWS Budgets | 샌드박스 한도보다 낮은 금액에서 알림 발송 |

샌드박스가 예산 한도에서 리소스를 정지시키므로 알림 금액을 한도보다 낮게 잡는다.

## 네트워크

ECS task는 public 서브넷에 두고 보안 그룹으로 접근을 제한한다.
RDS는 private 서브넷에 둔다.

NAT Gateway는 만들지 않는다.
S3 통신은 gateway endpoint를 거친다.

## 출력값

`buddybird-app`이 StackReference로 읽는 값이다.

| 출력값 | 사용처 |
| --- | --- |
| `vpc_id` | RDS 서브넷 그룹 |
| `public_subnet_ids` | ECS 서비스의 네트워크 설정 |
| `private_subnet_ids` | RDS 서브넷 그룹 |
| `task_security_group_id` | ECS 서비스의 네트워크 설정 |
| `db_security_group_id` | RDS 인스턴스 |
| `cache_security_group_id` | ElastiCache Serverless 캐시 |
| `cluster_arn` | ECS 서비스 |
| `https_listener_arn` | 리스너 규칙 |
| `cloudfront_certificate_arn` | CloudFront 배포 |

출력값은 다른 스택이 사용하는 것만 export한다.

## 수동 단계

첫 적용에서 ACM 인증서 검증이 완료를 기다리며 멈춘다.
`pulumi stack output`에 나온 검증 CNAME을 Cloudflare에 등록하면 적용이 이어진다.

인증서는 두 개이고 리전이 다르므로 검증 CNAME도 각각 등록한다.
