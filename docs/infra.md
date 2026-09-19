# joynnovate-infra

서비스들이 공유하는 VPC, 보안 그룹, ALB, ECS 클러스터 구성

## 파일 구성

| 파일 | 역할 |
|---|---|
| `__main__.py` | 상수, 컴포넌트 조립, 출력값 |
| `logs.py` | `Logging` 컴포넌트 |
| `network.py` | `Network` 컴포넌트 |
| `serving.py` | `Serving` 컴포넌트 |
| `bastion.py` | `Bastion` 컴포넌트 |
| `cost.py` | `Cost` 컴포넌트 |

## 리소스 구성

모든 리소스는 컴포넌트 아래에 있습니다.
컴포넌트는 `(name, args, opts)` 생성자와 `@dataclass` Args를 사용하고 자식 논리 이름에 컴포넌트 이름을 접두어로 붙입니다.

| 컴포넌트 | 이름 | 리소스 |
|---|---|---|
| `Logging` | `jn-logging` | 로그 버킷, 암호화, public access block, 라이프사이클, 버킷 정책 |
| `Network` | `jn` | VPC, 서브넷, 라우팅, S3 엔드포인트, 보안 그룹, Flow Log |
| `Serving` | `jn` | ECS 클러스터, ACM 인증서, ALB, 리스너 |
| `Bastion` | `jn-bastion` | EC2, IAM 역할, 인스턴스 프로파일 |
| `Cost` | `jn-cost` | 월 예산 |

## VPC

| 항목 | 값 |
|---|---|
| CIDR | `10.0.0.0/16` |
| DNS 지원 | 활성화 |
| DNS 호스트명 | 활성화 |
| S3 gateway endpoint | public, private 라우트 테이블 연결 |

### 서브넷

| 구분 | CIDR | 용도 |
|---|---|---|
| public | `10.0.0.0/24`, `10.0.1.0/24` | ECS task, SSM bastion |
| private | `10.0.10.0/24`, `10.0.11.0/24` | RDS |

### 라우팅

| 라우트 테이블 | 경로 |
|---|---|
| public | `0.0.0.0/0` → 인터넷 게이트웨이 |
| private | X |

## 보안 그룹

| 보안 그룹 | 인바운드 | 아웃바운드 |
|---|---|---|
| `jn-alb` | 인터넷 → 80, 443 | 전체 |
| `jn-task` | `jn-alb` → 전체 | 전체 |
| `jn-db` | - `jn-task` → 5432<br>- `jn-ssm` → 5432 | 전체 |
| `jn-ssm` | X | 전체 |
| 기본 SG | 모든 규칙 제거, `do-not-use` 표시 | 모든 규칙 제거 |

## SSM bastion

| 항목 | 값 |
|---|---|
| AMI | Amazon Linux 2023 ARM64 |
| AMI 갱신 | 새 AMI가 게시돼도 인스턴스 유지, 교체는 `pulumi up --replace`로 실행 |
| 인스턴스 타입 | t4g.nano |
| 구매 옵션 | Spot, persistent 요청, 회수 시 stop |
| 서브넷 | public 서브넷 첫 번째 |
| 보안 그룹 | `jn-ssm` |
| IAM 역할 | `jn-ssm` (`AmazonSSMManagedInstanceCore`) |
| IMDSv2 | 필수 |
| SSH 키 | X |
| 접속 방법 | `ssm-db-access.md` 참고 |

## ALB

| 항목 | 값 |
|---|---|
| 타입 | Application Load Balancer |
| 서브넷 | public |
| access log | 로그 버킷으로 전송 |

### 리스너

| 포트 | 동작 |
|---|---|
| 443 | TLS 1.3 정책 `ELBSecurityPolicy-TLS13-1-2-2021-06`, 기본 404 응답 |
| 80 | 443으로 리다이렉트 |

### ACM 인증서

| 용도 | 리전 | 도메인 | 검증 |
|---|---|---|---|
| ALB | ap-northeast-2 | 루트, 와일드카드 | Cloudflare DNS 레코드 공유 |
| CloudFront | us-east-1 | 루트, 와일드카드 | Cloudflare DNS 레코드 공유 |

## ECS 클러스터

| 항목 | 값 |
|---|---|
| 이름 | `jn-cluster` |
| 타입 | Fargate |
| capacity provider | `FARGATE`, `FARGATE_SPOT` |

## 로그

| 항목 | 값 |
|---|---|
| ALB access log prefix | `alb` |
| VPC flow log prefix | `vpc-flow-log` |
| VPC flow log 대상 | 거부된 트래픽 |
| 보존 기간 | 30일 |
| 버킷 암호화 | SSE-S3 |

## 비용 한도

| 항목 | 값 |
|---|---|
| 한도 | 월 200 USD |
| 알림 | 실제 지출 50%, 75%, 90% |
| 수신 | 팀 이메일 |

## 출력값

| 출력값 | 사용처 |
|---|---|
| `vpc_id` | 타깃 그룹 |
| `public_subnet_ids` | ECS 서비스 네트워크 설정 |
| `private_subnet_ids` | RDS 서브넷 그룹 |
| `task_security_group_id` | ECS 서비스 네트워크 설정 |
| `db_security_group_id` | RDS 인스턴스 |
| `ssm_instance_id` | SSM port forwarding 대상 |
| `cluster_arn` | ECS 서비스, 배포 역할 권한 범위 |
| `alb_dns_name` | CNAME, CloudFront API 오리진 |
| `https_listener_arn` | 리스너 규칙 |
| `cloudfront_certificate_arn` | CloudFront 배포 |

## 수동 단계

첫 적용 전에 Cloudflare API 토큰을 스택 secret으로 저장합니다.

```bash
pulumi config set --secret cloudflare:apiToken <토큰>
```
