# joynnovate-infra

여러 제품이 함께 사용하는 네트워크와 서빙 기반을 만든다.

| 파일 | 담당 |
| --- | --- |
| `__main__.py` | - 로그 버킷<br>- 예산 알림<br>- 컴포넌트 조립<br>- 출력값 |
| `network.py` | `Network` 컴포넌트 |
| `serving.py` | `Serving` 컴포넌트 |

## network.py

| 리소스 | 구성 |
| --- | --- |
| Virtual Private Cloud(VPC) | - Classless Inter-Domain Routing(CIDR) 10.0.0.0/16<br>- Domain Name System(DNS) 지원 활성화<br>- DNS 호스트명 활성화 |
| 인터넷 게이트웨이 | VPC에 연결 |
| public 서브넷 | Availability Zone(AZ)마다 하나 |
| private 서브넷 | AZ마다 하나 |
| 라우트 테이블 | 계층마다 하나 |
| Simple Storage Service(S3) gateway endpoint | 모든 라우트 테이블에 연결 |
| 기본 보안 그룹 | - 규칙 전체 제거<br>- 이름에 미사용 표시 |
| VPC flow log | 전체 트래픽을 로그 버킷으로 전송 |

S3 통신은 gateway endpoint를 경유한다.

### 서브넷 배치

| 리소스 | 서브넷 |
| --- | --- |
| Elastic Container Service(ECS) task | public |
| Relational Database Service(RDS) | private |

### 보안 그룹

| 보안 그룹 | 인바운드 | 비고 |
| --- | --- | --- |
| Application Load Balancer(ALB)용 | - 인터넷에서 80<br>- 인터넷에서 443 | |
| ECS task용 | ALB 보안 그룹에서 오는 모든 트래픽 | - 서비스보다 먼저 생성되기 때문에 제품별 포트를 알 수 없음<br>- 출발지만 제한 |
| RDS용 | ECS task 보안 그룹에서 5432 | |
| 캐시용 | - ECS task 보안 그룹에서 6379<br>- ECS task 보안 그룹에서 6380 | - 사용처 없음<br>- ElastiCache Serverless의 쓰기 포트<br>- ElastiCache Serverless의 읽기 포트 |

보안 그룹 규칙의 `description`은 영문으로 작성한다.
Amazon Elastic Compute Cloud(EC2)가 `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*` 밖의 문자를 거부하기 때문이다.
한글을 작성하면 `InvalidParameterValue`로 실패한다.

## serving.py

| 리소스 | 구성 |
| --- | --- |
| ECS 클러스터 | - 이름 `jn-cluster`<br>- Fargate |
| AWS Certificate Manager(ACM) 인증서 | - ALB용<br>- ap-northeast-2 |
| ACM 인증서 | - CloudFront용<br>- us-east-1 |
| Cloudflare DNS 레코드 | 인증서가 함께 사용하는 검증 Canonical Name(CNAME) |
| ALB | - public 서브넷에 배치<br>- access log를 로그 버킷으로 전송 |
| 리스너 | - 포트 443<br>- ALB 인증서 연결<br>- 기본 동작은 404 응답 |
| 리스너 | - 포트 80<br>- 443으로 리다이렉트 |

리스너 규칙과 타깃 그룹은 `buddybird-app`이 만든다.

### 인증서

인증서는 모두 루트 도메인과 와일드카드를 포함한다.

Cloudflare 검증 레코드는 하나만 만든다.
ACM이 와일드카드와 루트 도메인에 같은 검증 값을 발급한다.

### TLS 정책

443 리스너에 `ELBSecurityPolicy-TLS13-1-2-2021-06`을 지정한다.
기본 정책은 Transport Layer Security(TLS) 1.0까지 허용한다.

## __main__.py

| 리소스 | 구성 |
| --- | --- |
| 로그 버킷 | - ALB access log 저장<br>- VPC flow log 저장 |
| AWS Budgets | - 월 120 USD<br>- 실제 지출 기준 |

로그는 종류별 prefix로 나눈다.
30일 후 삭제한다.

flow log는 S3로 전송한다.
CloudWatch Logs는 GB당 수집 비용이 두 배다.

한도의 50%, 75%, 90% 사용 시 팀 이메일로 알림을 전송한다.

### 버킷 정책 주의

버킷 암호화는 SSE-S3를 사용한다.
ALB access log는 SSE-S3로 암호화한 버킷에만 저장된다.

flow log 쓰기 권한의 대상은 버킷 전체로 지정한다.
flow log를 만들면 AWS가 `delivery.logs.amazonaws.com` 권한을 버킷 정책에 직접 작성하면서 기존 정책을 덮어쓴다.
버킷 전체를 이미 허용하고 있으면 AWS가 정책을 변경하지 않기 때문에 ALB access log 권한이 유지된다.

## 출력값

| 출력값 | 사용처 |
| --- | --- |
| `vpc_id` | 타깃 그룹 |
| `public_subnet_ids` | ECS 서비스 네트워크 설정 |
| `private_subnet_ids` | RDS 서브넷 그룹 |
| `task_security_group_id` | ECS 서비스 네트워크 설정 |
| `db_security_group_id` | RDS 인스턴스 |
| `cache_security_group_id` | 사용처 없음 |
| `cluster_arn` | - ECS 서비스<br>- 배포 역할 권한 범위 |
| `alb_dns_name` | - 서비스 호스트명 CNAME<br>- CloudFront의 API 오리진 |
| `https_listener_arn` | 리스너 규칙 |
| `cloudfront_certificate_arn` | CloudFront 배포 |

이 스택을 destroy한 후에는 `buddybird-app`도 다시 적용한다.

## 수동 단계

첫 적용 전에 Cloudflare API 토큰을 스택 secret으로 저장한다.
토큰에는 대상 zone의 DNS 편집 권한을 부여한다.

```bash
pulumi config set --secret cloudflare:apiToken <토큰>
```
