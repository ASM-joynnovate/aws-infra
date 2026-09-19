# SSM DB 접속

SSM Session Manager port forwarding으로 private subnet RDS 접속

## 사전 조건

```bash
brew install --cask session-manager-plugin
```

## 접속 절차

### 1. instance ID 조회

```bash
cd infra
AWS_PROFILE=joynnovate pulumi stack output ssm_instance_id
```

### 2. RDS endpoint 조회

`<env>`에 `dev` 또는 `prod`를 입력합니다.

```bash
aws rds describe-db-instances \
  --profile joynnovate \
  --db-instance-identifier jn-buddybird-api-<env> \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

### 3. port forwarding 시작

```bash
aws ssm start-session \
  --profile joynnovate \
  --target <1에서 조회한 instance ID> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters host=<2에서 조회한 endpoint>,portNumber=5432,localPortNumber=5432
```

`Waiting for connections...`가 출력되면 별도 터미널을 엽니다.

bastion은 Spot 인스턴스입니다.
AWS가 인스턴스를 회수하면 세션이 끊기고 인스턴스는 stop 상태가 됩니다.
용량이 돌아오면 같은 instance ID로 다시 시작되므로 `TargetNotConnected` 오류가 나면 몇 분 뒤 다시 시도합니다.

### 4. readonly 사용자로 접속

```bash
PGPASSWORD=$(aws secretsmanager get-secret-value \
  --profile joynnovate \
  --secret-id jn-buddybird-api-<env>-readonly \
  --query SecretString --output text | jq -r .password) \
psql -h localhost -p 5432 -U readonly -d buddybird
```

