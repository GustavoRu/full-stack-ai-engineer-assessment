# Document Q&A Assistant: Infrastructure and Delivery Plan (3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the product deployable on paper and ready to hand in: Terraform for AWS, production settings in the API, an observability dashboard, the full README, and a verified clean-clone run.

**Architecture:** ECS on Fargate behind one load balancer that routes `/api/*` to the API and everything else to the frontend, RDS PostgreSQL in private subnets, and Secrets Manager for the three secrets. Logs are JSON lines that ECS ships to CloudWatch; metric filters turn them into metrics. Grafana is the visualization layer: locally it reads the audit table in PostgreSQL through an optional Compose profile.

**Tech Stack:** Terraform 1.16 with the AWS provider 6.x (validated through the `hashicorp/terraform:1.16` image), NestJS 12, Grafana 13, Docker Compose.

**Spec:** [docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md](../specs/2026-10-03-document-qa-assistant-design.md), sections 9, 10.2, 12 and 15.

**Plan series:**

1. Backend API, database and Docker for both: done.
2. Frontend and the full Compose stack: done.
3. Terraform, final README and delivery checks (this plan).

## Global Constraints

- Terraform is written and validated, never applied. No AWS account or credentials are used.
- Terraform creates secrets without values. No secret value appears in the repository, in variables or in state.
- The same images run in every environment; everything that differs is an environment variable.
- Document text, questions, answers and keys are never logged.
- **Free disk space must be at least 4 GB before starting.** The AWS provider is about 700 MB and the Grafana image about 1 GB unpacked. Check with `df -h /System/Volumes/Data` and stop if it is lower.
- Backend tests run with `pnpm test` (unit) and `pnpm test:int` (needs `docker compose up -d db`). Frontend tests run with `pnpm test` in `apps/web`.
- Manual checks use `LLM_PROVIDER=mock`, except the one step that measures real token usage.
- Code comments are in English, one line, with no task identifiers.
- Commits follow Conventional Commits and carry no co-author or AI attribution trailer.
- Work happens on the branch `feat/document-qa-assistant` in this checkout. No worktrees.

## Review Focus

Conditions the spec implies but does not spell out, most likely first. Each has a check in the task that owns it.

1. **A secret value must never reach Terraform state.** Task 2 greps the configuration for secret versions and plaintext values.
2. **Behind a load balancer every request has the balancer's IP.** Without the trust-proxy setting, rate limits per IP collapse into one bucket. Task 1.
3. **RDS rejects connections without TLS.** The API must connect with TLS and verify the certificate. Task 1.
4. **A fresh clone must run with the documented commands only.** Task 5 runs them from a clean clone.
5. **Log lines must stay free of user content after the format change.** Task 1 keeps and extends the existing assertions.

## Checkpoints

| After task | What to review |
|---|---|
| 2 | Production settings in the API and the Terraform files |
| 5 | Dashboard, README and the clean-clone run; decide how to merge and publish |

## File Structure

```
infra/
├── versions.tf          Terraform and provider versions, provider config
├── variables.tf         inputs: images, region, sizes, model config
├── network.tf           VPC, subnets, NAT, routes, security groups
├── alb.tf               load balancer, target groups, listener and path rule
├── rds.tf               PostgreSQL with a managed master password
├── secrets.tf           Secrets Manager secrets, without values
├── ecs.tf               ECR, cluster, roles, task definitions, services, autoscaling
├── observability.tf     log groups, metric filters, alarm
├── outputs.tf
└── grafana/
    ├── provisioning/datasources/postgres.yml
    ├── provisioning/dashboards/dashboards.yml
    └── dashboards/docqa.json
apps/api/src/
├── config/env.ts        adds DB_SSL and TRUST_PROXY_HOPS
├── app.setup.ts         applies the trust-proxy setting
├── main.ts              JSON logger
└── (services, filters)  log objects instead of strings
```

---

### Task 1: Production settings in the API

**Files:**
- Modify: `apps/api/src/config/env.ts`, `apps/api/src/config/env.spec.ts`
- Modify: `apps/api/src/database/database.module.ts`, `apps/api/src/app.setup.ts`, `apps/api/src/main.ts`
- Modify: `apps/api/src/questions/questions.service.ts`, `apps/api/src/documents/documents.service.ts`, `apps/api/src/common/llm-exception.filter.ts`, `apps/api/src/common/safe-exception.filter.ts` and their specs
- Modify: `apps/api/Dockerfile`, `.env.example`
- Create: `apps/api/test/proxy.int-spec.ts`

**Interfaces:**
- Consumes: `Env`, `configureApp`, the log call sites from Plan 1.
- Produces:
  - `DB_SSL` (boolean, default `false`) and `TRUST_PROXY_HOPS` (integer, default `0`) in `Env`.
  - Log calls that pass an object. With the JSON logger each line is `{ level, pid, timestamp, message: { event, ... }, context }`.
  - The RDS certificate bundle at `/app/certs/rds-global-bundle.pem` inside the API image.

- [ ] **Step 1: Write the failing configuration tests**

In `apps/api/src/config/env.spec.ts`, add before the test `'rejects an unknown provider'`:

```ts
  it('keeps database TLS and proxy trust off by default and reads them when set', () => {
    const defaults = validateEnv(base);
    expect(defaults.DB_SSL).toBe(false);
    expect(defaults.TRUST_PROXY_HOPS).toBe(0);

    const production = validateEnv({ ...base, DB_SSL: 'true', TRUST_PROXY_HOPS: '1' });
    expect(production.DB_SSL).toBe(true);
    expect(production.TRUST_PROXY_HOPS).toBe(1);

    expect(() => validateEnv({ ...base, TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/config`
Expected: FAIL, `expected undefined to be false`.

- [ ] **Step 3: Add the two settings to `apps/api/src/config/env.ts`**

Add this helper above `envSchema`, and use it for `API_DOCS_ENABLED` too:

```ts
const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');
```

Replace the `API_DOCS_ENABLED` entry and add the new ones:

```ts
    API_DOCS_ENABLED: flag('true'),
    // Number of reverse proxies in front of the API; 0 means it is reached directly
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
```

```ts
    DB_PASSWORD: z.string().default('docqa'),
    DB_SSL: flag('false'),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/config`
Expected: PASS, 7 tests.

- [ ] **Step 5: Use the settings**

In `apps/api/src/database/database.module.ts`, add to the `pg.Pool` options:

```ts
          // Verifies the server certificate against Node's trust store plus NODE_EXTRA_CA_CERTS
          ssl: config.get('DB_SSL', { infer: true }),
```

In `apps/api/src/app.setup.ts`, add after `app.enableShutdownHooks();`:

```ts
  // Behind a load balancer the client address comes from X-Forwarded-For
  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', proxyHops);
  }
```

Append to `.env.example`:

```dotenv
# Production only: TLS to the database and the number of proxies in front of the API
DB_SSL=false
TRUST_PROXY_HOPS=0
```

- [ ] **Step 6: Write the failing proxy test**

Create `apps/api/test/proxy.int-spec.ts`:

```ts
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

// The login route allows 10 requests per minute per client address

let app: INestApplication;
let api: string;

async function login(forwardedFor: string): Promise<number> {
  const response = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
  });
  return response.status;
}

beforeAll(async () => {
  // Set before the module is imported, because the configuration is read at import time
  process.env.TRUST_PROXY_HOPS = '1';
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  api = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  delete process.env.TRUST_PROXY_HOPS;
  await app.close();
});

describe('rate limits behind a proxy', () => {
  it('counts each forwarded client address separately', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push(await login('203.0.113.10'));

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);

    // Another client is not affected by the first one's limit
    expect(await login('203.0.113.20')).toBe(401);
  });
});
```

- [ ] **Step 7: Run it to verify the behavior**

```bash
docker compose -f ../../docker-compose.yml up -d db
pnpm test:int
```

Expected: PASS, 8 tests in 2 files.

Then prove the test is sensitive: comment out the `set('trust proxy', ...)` line, run `pnpm test:int`, and confirm the new test fails with `expected 429 to be 401`. Restore the line and run again to see it pass.

- [ ] **Step 8: Write the failing log-format tests**

The four log tests currently parse a string. Change them to read an object.

In `apps/api/src/questions/questions.service.spec.ts`, in the test `'logs a failed model call with its metadata and without the question'`, replace the lines from `const line = String(...)` to the end of the test with:

```ts
    const entry = warn.mock.calls[0]?.[0];
    warn.mockRestore();
    expect(entry).toMatchObject({
      event: 'question_failed',
      userId: 'user-1',
      documentId: 'doc-1',
      provider: 'test-provider',
      model: 'test-chat',
      promptVersion: 'qa-v1',
      error: 'LlmInvalidResponseError',
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(JSON.stringify(entry)).not.toContain('secret');
  });
```

In `apps/api/src/documents/documents.service.spec.ts`, make the same change in both log tests: replace `const line = String(log.mock.calls[0]?.[0]);` with `const entry = log.mock.calls[0]?.[0];` (and `warn` in the second), replace `expect(JSON.parse(line)).toMatchObject(` with `expect(entry).toMatchObject(`, and replace `expect(line).not.toMatch(/secret/i);` with `expect(JSON.stringify(entry)).not.toMatch(/secret/i);`.

- [ ] **Step 9: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL in 3 tests, because the logged value is a string and `toMatchObject` needs an object.

- [ ] **Step 10: Log objects and switch to the JSON logger**

In `apps/api/src/questions/questions.service.ts` and `apps/api/src/documents/documents.service.ts`, remove the `JSON.stringify(` wrapper and its closing `)` from every `this.logger.log(` and `this.logger.warn(` call, so the object literal is passed directly. For example:

```ts
      this.logger.warn({
        event: 'question_failed',
        ...this.callMetadata(userId, documentId),
        error: error instanceof Error ? error.name : 'unknown',
        inputTokens: result?.inputTokens,
        outputTokens: result?.outputTokens,
        latencyMs: Date.now() - startedAt,
      });
```

Do the same in `apps/api/src/common/llm-exception.filter.ts` (`this.logger.warn({ event: 'llm_error', ... })`) and `apps/api/src/common/safe-exception.filter.ts` (`this.safeLogger.error(describeError(exception))`).

Replace `apps/api/src/main.ts`:

```ts
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  // One JSON object per line, so log tools can filter by field
  const app = await NestFactory.create(AppModule, { logger: new ConsoleLogger({ json: true }) });
  const config = configureApp(app);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
```

- [ ] **Step 11: Run all tests and check the real log shape**

```bash
pnpm test && pnpm lint && pnpm build
PORT=3101 LLM_PROVIDER=mock API_DOCS_ENABLED=false node dist/main.js > /tmp/api-json.log 2>&1 & API_PID=$!
API=localhost:3101/api; J='Content-Type: application/json'
curl -s --retry 10 --retry-all-errors --retry-delay 1 -o /dev/null $API/health
TOKEN=$(curl -s -X POST $API/auth/register -H "$J" -d "{\"email\":\"json-$(date +%s)@example.com\",\"password\":\"correct-horse\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
DOC=$(curl -s -X POST $API/documents -H "Authorization: Bearer $TOKEN" -F 'text=Paris is the capital of France.' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
curl -s -o /dev/null -X POST $API/documents/$DOC/questions -H "Authorization: Bearer $TOKEN" -H "$J" -d '{"question":"What is the capital of France?"}'
kill $API_PID
grep question_answered /tmp/api-json.log | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8").trim().split("\n").pop()); console.log(typeof l.message, l.message.event, l.level, l.context)'
grep -c "capital of France" /tmp/api-json.log
```

Expected: 90 unit tests pass; lint and build are clean. The node line prints `object question_answered log QuestionsService`, and the grep count is `0`.

If `message` is a string instead of an object, the metric filters of Task 2 must use `$.message` text matching; record that as a ruling and adjust the filter patterns there.

- [ ] **Step 12: Add the RDS certificate bundle to the image**

In `apps/api/Dockerfile`, in the runtime stage, add before `USER node`:

```dockerfile
# Amazon RDS certificate authorities, used when NODE_EXTRA_CA_CERTS points here
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
```

Verify:

```bash
cd ../..
docker compose up -d --build api
curl -s --retry 20 --retry-all-errors --retry-delay 2 localhost:3001/api/health; echo
docker compose exec -T api sh -c 'head -1 /app/certs/rds-global-bundle.pem; id -un'
```

Expected: `{"status":"ok"}`, then `-----BEGIN CERTIFICATE-----` and `node`.

- [ ] **Step 13: Commit**

```bash
(cd apps/api && pnpm test && pnpm test:int)
git add apps/api .env.example
git commit -m "feat(api): add JSON logs, database TLS and proxy-aware rate limits"
```

---

### Task 2: Terraform for AWS

**Files:**
- Create: `infra/versions.tf`, `variables.tf`, `network.tf`, `alb.tf`, `rds.tf`, `secrets.tf`, `ecs.tf`, `observability.tf`, `outputs.tf`

**Interfaces:**
- Consumes: the image settings from Plans 1 and 2 (ports 3001 and 3000, health paths `/api/health` and `/login`), the environment variables of spec section 9 and Task 1, and the log shape verified in Task 1 Step 11.
- Produces: a configuration that passes `terraform fmt -check` and `terraform validate`.

- [ ] **Step 1: Create `infra/versions.tf`**

```hcl
terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State is local here because nothing is applied. A real deployment would use
  # an S3 backend with locking and encryption.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}
```

- [ ] **Step 2: Create `infra/variables.tf`**

```hcl
variable "project" {
  description = "Name used as a prefix for every resource"
  type        = string
  default     = "docqa"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "api_image" {
  description = "Full image reference of the API, including the tag"
  type        = string
}

variable "web_image" {
  description = "Full image reference of the frontend, built with NEXT_PUBLIC_API_URL=/api"
  type        = string
}

variable "cpu_architecture" {
  description = "Must match the platform the images were built for"
  type        = string
  default     = "ARM64"
}

variable "api_min_count" {
  type    = number
  default = 1
}

variable "api_max_count" {
  type    = number
  default = 4
}

variable "requests_per_task_target" {
  description = "Requests per minute one API task should handle before another is added"
  type        = number
  default     = 60
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# Model configuration: changing these needs no new image
variable "llm_provider" {
  type    = string
  default = "gemini"
}

variable "gemini_chat_model" {
  type    = string
  default = "gemini-3.1-flash-lite"
}

variable "gemini_embedding_model" {
  type    = string
  default = "gemini-embedding-001"
}

variable "prompt_version" {
  type    = string
  default = "qa-v1"
}

variable "api_limits" {
  description = "Limits passed to the API as environment variables"
  type        = map(string)
  default = {
    MAX_UPLOAD_BYTES   = "5242880"
    MAX_DOCUMENT_CHARS = "50000"
    MAX_QUESTION_CHARS = "1000"
    RETRIEVAL_TOP_K    = "5"
    MAX_OUTPUT_TOKENS  = "800"
  }
}
```

- [ ] **Step 3: Create `infra/network.tf`**

```hcl
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = var.project }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

# Public subnets hold only the load balancer and the NAT gateway
resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${var.project}-public-${count.index}" }
}

# Private subnets hold the tasks and the database
resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = local.azs[count.index]

  tags = { Name = "${var.project}-private-${count.index}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
}

# Outbound path for the tasks: the Gemini API, ECR and Secrets Manager
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  depends_on = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count = 2

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Internet -> load balancer -> tasks -> database, and nothing else
resource "aws_security_group" "alb" {
  name        = "${var.project}-alb"
  description = "Public HTTP to the load balancer"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "tasks" {
  name        = "${var.project}-tasks"
  description = "Traffic from the load balancer to the tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Frontend and API ports from the load balancer only"
    from_port       = 3000
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db"
  description = "PostgreSQL from the tasks only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from the tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
}
```

- [ ] **Step 4: Create `infra/alb.tf`**

```hcl
resource "aws_lb" "main" {
  name               = var.project
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # A question can take up to about 96 s: three attempts of 30 s each plus waits
  idle_timeout = 120
}

resource "aws_lb_target_group" "api" {
  name        = "${var.project}-api"
  port        = 3001
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  health_check {
    path              = "/api/health"
    matcher           = "200"
    interval          = 15
    healthy_threshold = 2
  }
}

resource "aws_lb_target_group" "web" {
  name        = "${var.project}-web"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  health_check {
    path              = "/login"
    matcher           = "200"
    interval          = 15
    healthy_threshold = 2
  }
}

# HTTP only: there is no domain, so no certificate. Production adds an HTTPS
# listener with an ACM certificate and redirects port 80 to it.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# One host serves both, so the browser calls the API on the same origin and needs no CORS
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}
```

- [ ] **Step 5: Create `infra/rds.tf`**

```hcl
resource "aws_db_subnet_group" "main" {
  name       = var.project
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = var.project
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_encrypted = true

  db_name  = "docqa"
  username = "docqa"
  # RDS creates and stores the password in Secrets Manager, so it never appears here or in state
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  backup_retention_period   = 7
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project}-final"
}
```

- [ ] **Step 6: Create `infra/secrets.tf`**

```hcl
# Terraform creates the secrets but not their values. The values are set out of
# band, so they never reach the repository, the variables or the state:
#   aws secretsmanager put-secret-value --secret-id docqa/gemini-api-key --secret-string "..."

resource "aws_secretsmanager_secret" "gemini_api_key" {
  name        = "${var.project}/gemini-api-key"
  description = "API key of the LLM provider"
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "${var.project}/jwt-secret"
  description = "Signing secret for access tokens"
}
```

- [ ] **Step 7: Create `infra/observability.tf`**

```hcl
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project}/api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.project}/web"
  retention_in_days = var.log_retention_days
}

# The API writes one JSON object per line, so metrics come from fields, not text matching.
# Grafana or CloudWatch dashboards read these metrics and the audit table in PostgreSQL.

resource "aws_cloudwatch_log_metric_filter" "questions_answered" {
  name           = "${var.project}-questions-answered"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.message.event = \"question_answered\" }"

  metric_transformation {
    name      = "QuestionsAnswered"
    namespace = "DocQA"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "question_failures" {
  name           = "${var.project}-question-failures"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.message.event = \"question_failed\" }"

  metric_transformation {
    name      = "QuestionFailures"
    namespace = "DocQA"
    value     = "1"
  }
}

# Token usage is what the provider bills, so it is tracked as its own metric
resource "aws_cloudwatch_log_metric_filter" "output_tokens" {
  name           = "${var.project}-output-tokens"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.message.event = \"question_answered\" }"

  metric_transformation {
    name      = "OutputTokens"
    namespace = "DocQA"
    value     = "$.message.outputTokens"
  }
}

resource "aws_cloudwatch_metric_alarm" "question_failures" {
  alarm_name          = "${var.project}-question-failures"
  alarm_description   = "More than 5 failed questions in 5 minutes: provider outage, quota or a bad prompt version"
  namespace           = "DocQA"
  metric_name         = "QuestionFailures"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
```

- [ ] **Step 8: Create `infra/ecs.tf`**

```hcl
resource "aws_ecr_repository" "api" {
  name                 = "${var.project}/api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "${var.project}/web"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecs_cluster" "main" {
  name = var.project
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by ECS itself to pull images, write logs and read the secrets at task start
resource "aws_iam_role" "execution" {
  name               = "${var.project}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Least privilege: only these three secrets can be read
data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.gemini_api_key.arn,
      aws_secretsmanager_secret.jwt_secret.arn,
      aws_db_instance.main.master_user_secret[0].secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "read_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

# Used by the application code. It has no policies because the app calls no AWS API
resource "aws_iam_role" "task" {
  name               = "${var.project}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

locals {
  # Plain configuration: the same image runs everywhere and only these values change
  api_environment = merge(var.api_limits, {
    PORT                   = "3001"
    WEB_ORIGIN             = "http://${aws_lb.main.dns_name}"
    API_DOCS_ENABLED       = "false"
    TRUST_PROXY_HOPS       = "1"
    DB_HOST                = aws_db_instance.main.address
    DB_PORT                = "5432"
    DB_NAME                = "docqa"
    DB_USER                = "docqa"
    DB_SSL                 = "true"
    NODE_EXTRA_CA_CERTS    = "/app/certs/rds-global-bundle.pem"
    JWT_EXPIRES_IN_SECONDS = "3600"
    LLM_PROVIDER           = var.llm_provider
    GEMINI_CHAT_MODEL      = var.gemini_chat_model
    GEMINI_EMBEDDING_MODEL = var.gemini_embedding_model
    PROMPT_VERSION         = var.prompt_version
  })
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name         = "api"
      image        = var.api_image
      essential    = true
      portMappings = [{ containerPort = 3001, protocol = "tcp" }]

      environment = [for name, value in local.api_environment : { name = name, value = value }]

      # Injected by ECS when the task starts; rotating a key means a new secret
      # version followed by a new deployment
      secrets = [
        { name = "GEMINI_API_KEY", valueFrom = aws_secretsmanager_secret.gemini_api_key.arn },
        { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt_secret.arn },
        { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.project}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name         = "web"
      image        = var.web_image
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.web.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_min_count
  launch_type     = "FARGATE"

  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  # A deployment that never becomes healthy is rolled back automatically
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Autoscaling owns the count after creation
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.api]
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.api_min_count
  max_capacity       = var.api_max_count
}

# Scales on requests, not CPU: a task waiting on the model is idle, so CPU says nothing about load
resource "aws_appautoscaling_policy" "api_requests" {
  name               = "${var.project}-api-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = var.requests_per_task_target
    scale_out_cooldown = 30
    scale_in_cooldown  = 120

    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
  }
}
```

- [ ] **Step 9: Create `infra/outputs.tf`**

```hcl
output "url" {
  description = "Address of the application"
  value       = "http://${aws_lb.main.dns_name}"
}

output "ecr_repositories" {
  description = "Where to push the two images"
  value = {
    api = aws_ecr_repository.api.repository_url
    web = aws_ecr_repository.web.repository_url
  }
}

output "secrets_to_fill" {
  description = "Secrets whose values must be set by hand before the first deployment"
  value = [
    aws_secretsmanager_secret.gemini_api_key.name,
    aws_secretsmanager_secret.jwt_secret.name,
  ]
}
```

- [ ] **Step 10: Format and validate**

```bash
df -h /System/Volumes/Data | tail -1
docker run --rm -v "$PWD/infra:/infra" -w /infra hashicorp/terraform:1.16 fmt -recursive
docker run --rm -v "$PWD/infra:/infra" -w /infra hashicorp/terraform:1.16 fmt -check -recursive; echo "fmt exit $?"
docker run --rm -v "$PWD/infra:/infra" -w /infra hashicorp/terraform:1.16 init -backend=false -input=false
docker run --rm -v "$PWD/infra:/infra" -w /infra hashicorp/terraform:1.16 validate
```

Expected: `fmt exit 0`, `Terraform has been successfully initialized!` and `Success! The configuration is valid.`

If `validate` reports an error, fix the file it names and run it again. A provider-schema error means the AWS provider 6.x renamed an argument: read the message, apply the rename, and record it as a ruling.

- [ ] **Step 11: Check that no secret value can reach the state**

```bash
grep -rnE "aws_secretsmanager_secret_version|secret_string|\bpassword *=" infra/*.tf; echo "matches exit $?"
grep -rn "GEMINI_API_KEY\|JWT_SECRET\|DB_PASSWORD" infra/*.tf
```

Expected: the first grep prints nothing and `matches exit 1`. The second shows the three names only inside the `secrets` block of `ecs.tf`, each with a `valueFrom`.

- [ ] **Step 12: Clean up and commit**

The provider download is large and is not committed. The lock file is.

```bash
rm -rf infra/.terraform
git add infra
git status --short | grep -c "\.terraform/"; echo "provider files staged: $?"
git commit -m "feat(infra): add Terraform for ECS Fargate, RDS, secrets and observability"
```

Expected: the count is `0` and `infra/.terraform.lock.hcl` is part of the commit.

**Checkpoint:** stop here and review Tasks 1 and 2.

---

### Task 3: Grafana dashboard over the audit table

**Files:**
- Create: `infra/grafana/provisioning/datasources/postgres.yml`, `infra/grafana/provisioning/dashboards/dashboards.yml`, `infra/grafana/dashboards/docqa.json`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: the `questions` table (columns `created_at`, `status`, `latency_ms`, `input_tokens`, `output_tokens`, `model`, `prompt_version`) and the `db` service.
- Produces: an optional `grafana` service on http://localhost:3002, started with `docker compose --profile observability up -d`, with the dashboard "Document Q&A" loaded.

- [ ] **Step 1: Create the data source**

`infra/grafana/provisioning/datasources/postgres.yml`:

```yaml
apiVersion: 1

datasources:
  - name: DocQA PostgreSQL
    uid: docqa-postgres
    type: grafana-postgresql-datasource
    access: proxy
    url: db:5432
    user: ${DB_USER}
    isDefault: true
    editable: false
    jsonData:
      database: ${DB_NAME}
      sslmode: disable
    secureJsonData:
      password: ${DB_PASSWORD}
```

- [ ] **Step 2: Create the dashboard provider**

`infra/grafana/provisioning/dashboards/dashboards.yml`:

```yaml
apiVersion: 1

providers:
  - name: docqa
    type: file
    disableDeletion: true
    allowUiUpdates: false
    options:
      path: /var/lib/grafana/dashboards
```

- [ ] **Step 3: Create the dashboard**

`infra/grafana/dashboards/docqa.json`:

```json
{
  "uid": "docqa",
  "title": "Document Q&A",
  "tags": ["docqa"],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": { "from": "now-24h", "to": "now" },
  "panels": [
    {
      "id": 1,
      "title": "Questions per hour",
      "type": "timeseries",
      "datasource": { "type": "grafana-postgresql-datasource", "uid": "docqa-postgres" },
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
      "targets": [
        {
          "refId": "A",
          "format": "time_series",
          "rawQuery": true,
          "rawSql": "SELECT date_trunc('hour', created_at) AS time, count(*) AS questions FROM questions WHERE $__timeFilter(created_at) GROUP BY 1 ORDER BY 1"
        }
      ]
    },
    {
      "id": 2,
      "title": "Answers by status",
      "type": "piechart",
      "datasource": { "type": "grafana-postgresql-datasource", "uid": "docqa-postgres" },
      "gridPos": { "h": 8, "w": 6, "x": 12, "y": 0 },
      "options": { "reduceOptions": { "values": true, "calcs": [] }, "legend": { "displayMode": "table", "values": ["value", "percent"] } },
      "targets": [
        {
          "refId": "A",
          "format": "table",
          "rawQuery": true,
          "rawSql": "SELECT status, count(*) AS answers FROM questions WHERE $__timeFilter(created_at) GROUP BY status ORDER BY status"
        }
      ]
    },
    {
      "id": 3,
      "title": "Estimated cost (USD)",
      "description": "Tokens times the list price of gemini-3.1-flash-lite: 0.25 USD per million input tokens and 1.50 per million output tokens",
      "type": "stat",
      "datasource": { "type": "grafana-postgresql-datasource", "uid": "docqa-postgres" },
      "gridPos": { "h": 8, "w": 6, "x": 18, "y": 0 },
      "fieldConfig": { "defaults": { "unit": "currencyUSD", "decimals": 4 } },
      "targets": [
        {
          "refId": "A",
          "format": "table",
          "rawQuery": true,
          "rawSql": "SELECT coalesce(sum(input_tokens) * 0.25 / 1e6 + sum(output_tokens) * 1.50 / 1e6, 0) AS usd FROM questions WHERE $__timeFilter(created_at)"
        }
      ]
    },
    {
      "id": 4,
      "title": "Latency p50 and p95 (ms)",
      "type": "timeseries",
      "datasource": { "type": "grafana-postgresql-datasource", "uid": "docqa-postgres" },
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 8 },
      "fieldConfig": { "defaults": { "unit": "ms" } },
      "targets": [
        {
          "refId": "A",
          "format": "time_series",
          "rawQuery": true,
          "rawSql": "SELECT date_trunc('hour', created_at) AS time, percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95 FROM questions WHERE $__timeFilter(created_at) GROUP BY 1 ORDER BY 1"
        }
      ]
    },
    {
      "id": 5,
      "title": "Tokens per hour",
      "type": "timeseries",
      "datasource": { "type": "grafana-postgresql-datasource", "uid": "docqa-postgres" },
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 8 },
      "targets": [
        {
          "refId": "A",
          "format": "time_series",
          "rawQuery": true,
          "rawSql": "SELECT date_trunc('hour', created_at) AS time, sum(input_tokens) AS input, sum(output_tokens) AS output FROM questions WHERE $__timeFilter(created_at) GROUP BY 1 ORDER BY 1"
        }
      ]
    },
    {
      "id": 6,
      "title": "By model and prompt version",
      "description": "Compares prompt versions and models: volume, share of questions the document did not cover, and latency",
      "type": "table",
      "datasource": { "type": "grafana-postgresql-datasource", "uid": "docqa-postgres" },
      "gridPos": { "h": 8, "w": 24, "x": 0, "y": 16 },
      "targets": [
        {
          "refId": "A",
          "format": "table",
          "rawQuery": true,
          "rawSql": "SELECT model, prompt_version, count(*) AS questions, round(100.0 * count(*) FILTER (WHERE status = 'not_found') / count(*), 1) AS not_found_pct, round(100.0 * count(*) FILTER (WHERE status = 'unverified') / count(*), 1) AS unverified_pct, round(avg(latency_ms)) AS avg_latency_ms, round(avg(input_tokens + output_tokens)) AS avg_tokens FROM questions WHERE $__timeFilter(created_at) GROUP BY model, prompt_version ORDER BY questions DESC"
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Add the optional service to `docker-compose.yml`**

Add after the `web` service and before `volumes`:

```yaml
  # Optional: docker compose --profile observability up -d, then http://localhost:3002
  grafana:
    image: grafana/grafana:13.2.3
    profiles: ["observability"]
    environment:
      # Local convenience only: anyone on this machine can view the dashboard
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: Viewer
      GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /var/lib/grafana/dashboards/docqa.json
      DB_NAME: ${DB_NAME:-docqa}
      DB_USER: ${DB_USER:-docqa}
      DB_PASSWORD: ${DB_PASSWORD:-docqa}
    ports:
      - "127.0.0.1:3002:3000"
    volumes:
      - ./infra/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./infra/grafana/dashboards:/var/lib/grafana/dashboards:ro
    depends_on:
      db:
        condition: service_healthy
```

- [ ] **Step 5: Verify that the default stack is unchanged and the dashboard loads**

```bash
docker compose config --services | sort | tr '\n' ' '; echo
df -h /System/Volumes/Data | tail -1
docker compose --profile observability up -d grafana
curl -s --retry 30 --retry-all-errors --retry-delay 2 -o /dev/null -w 'grafana %{http_code}\n' localhost:3002/api/health
curl -s localhost:3002/api/dashboards/uid/docqa | node -pe 'const d=JSON.parse(require("fs").readFileSync(0)); d.dashboard.title + " | panels: " + d.dashboard.panels.length'
curl -s -u admin:admin -X POST localhost:3002/api/ds/query -H 'Content-Type: application/json' -d '{"queries":[{"refId":"A","datasource":{"uid":"docqa-postgres"},"format":"table","rawSql":"SELECT count(*) AS questions FROM questions"}],"from":"now-30d","to":"now"}' | node -pe 'const r=JSON.parse(require("fs").readFileSync(0)).results.A; r.error ?? ("rows: " + JSON.stringify(r.frames[0].data.values))'
```

Expected: the services line is `api db web` (Grafana is not in the default set); `grafana 200`; `Document Q&A | panels: 6`; and `rows: [[N]]` with the number of questions in the database.

If the data source type is rejected, list the installed types with `curl -s -u admin:admin localhost:3002/api/plugins?type=datasource | node -pe 'JSON.parse(require("fs").readFileSync(0)).map(p=>p.id).filter(i=>/postgres/.test(i))'`, use the id it prints in both files, and record the change as a ruling.

Then open http://localhost:3002 in a browser and confirm the six panels render with data.

- [ ] **Step 6: Commit**

```bash
git add infra/grafana docker-compose.yml
git commit -m "feat(infra): add an optional Grafana dashboard over the audit table"
```

---

### Task 4: Final README

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md`

**Interfaces:**
- Consumes: everything built in Plans 1 to 3 and the decisions of spec sections 13 and 15.
- Produces: a README that answers every "Explain" item of the brief (spec section 12 maps them).

- [ ] **Step 1: Measure real token usage**

This step spends about 6 requests of the Gemini quota. The API must run with `LLM_PROVIDER=gemini`.

```bash
cd apps/api && pnpm build
PORT=3101 LLM_PROVIDER=gemini API_DOCS_ENABLED=false node --env-file=../../.env dist/main.js > /tmp/api-measure.log 2>&1 & API_PID=$!
API=localhost:3101/api; J='Content-Type: application/json'
curl -s --retry 10 --retry-all-errors --retry-delay 1 -o /dev/null $API/health
TOKEN=$(curl -s -X POST $API/auth/register -H "$J" -d "{\"email\":\"measure-$(date +%s)@example.com\",\"password\":\"correct-horse\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
DOC=$(curl -s -X POST $API/documents -H "Authorization: Bearer $TOKEN" -F "file=@../../docs/CHALLENGE.md" | node -pe 'const d=JSON.parse(require("fs").readFileSync(0)); console.error("chunks:", d.chunkCount); d.id')
for q in "Which backend technologies are allowed?" "What must the README cover?" "What does the brief say about prompt injection?" "Which bonus sections are listed?" "What is the time expectation?"; do
  curl -s -X POST $API/documents/$DOC/questions -H "Authorization: Bearer $TOKEN" -H "$J" -d "{\"question\":\"$q\"}" | node -pe 'const r=JSON.parse(require("fs").readFileSync(0)); r.status + " in=" + r.usage?.inputTokens + " out=" + r.usage?.outputTokens'
done
kill $API_PID; cd ../..
docker compose exec -T db psql -U docqa -d docqa -c "SELECT count(*) AS questions, round(avg(input_tokens)) AS avg_in, round(avg(output_tokens)) AS avg_out, round(avg(latency_ms)) AS avg_ms FROM questions WHERE provider = 'gemini' AND input_tokens > 500"
```

Expected: five lines with a status and token counts, then one row with the averages. Write down `avg_in`, `avg_out` and `avg_ms`: Step 2 uses them.

- [ ] **Step 2: Add the remaining sections to `README.md`**

Append the text below. In the cost section, replace `AVG_IN`, `AVG_OUT` and `AVG_MS` with the numbers measured in Step 1, and compute the three "Measured" costs as `(AVG_IN × 0.25 + AVG_OUT × 1.50) / 1,000,000 × requests`, rounded to two decimals.

````markdown
## Scope choices

The brief offers three use cases. I chose question answering over documents
because it covers all three parts of the problem statement naturally: submit
content, interact with an assistant, and view structured output.

What I simplified, and why:

- **Each question is independent.** There is no conversation memory. This keeps
  the cost per question bounded and makes every answer reproducible.
- **Text-based PDFs only.** Scanned documents need OCR, which is a different
  problem.
- **Ingestion is synchronous.** The upload request extracts, chunks, embeds and
  stores. It caps document size at what fits in the provider's per-minute quota.

## Cost and rate limits

### What controls cost today

| Control | Where |
|---|---|
| Only the 5 most relevant passages are sent, never the whole document | `RETRIEVAL_TOP_K` |
| Output is capped | `MAX_OUTPUT_TOKENS` |
| Input is capped: question length, document size, upload size | See "Limits" |
| Per-user rate limits: 10 questions and 5 uploads per minute | `@nestjs/throttler` |
| The smallest model that does the job | `gemini-3.1-flash-lite` |
| Token counts are stored with every answer | `questions` table |

### Cost estimate

Prices are the list prices of `gemini-3.1-flash-lite`: 0.25 USD per million
input tokens and 1.50 USD per million output tokens. A request is one question:
one query embedding and one chat call. The query embedding costs less than
0.00001 USD and is left out.

| Scenario | Input tokens | Output tokens | 1k requests | 10k requests | 100k requests |
|---|---|---|---|---|---|
| Measured on a 5-question sample | AVG_IN | AVG_OUT | (computed) | (computed) | (computed) |
| Upper bound: 5 full passages | 1,450 | 100 | 0.51 USD | 5.13 USD | 51.25 USD |

Ingestion is a one-time cost per document. A document at the 50,000-character
limit is about 15,000 embedding tokens, which is 0.003 USD at 0.20 USD per
million tokens (the embedding price currently listed).

Infrastructure is the larger cost at low volume: the load balancer, the NAT
gateway, two small Fargate tasks and the smallest RDS instance run all month
regardless of traffic.

### What I would add in production

- **A budget per user and a global cap.** Per-user limits are fair but do not
  protect a shared provider quota. The token counts already stored make a daily
  budget a single query.
- **Caching.** Identical questions on the same document can return the stored
  answer. Provider-side context caching helps when the same passages repeat.
- **A queue for ingestion**, paced by the provider's tokens-per-minute limit.
- **Shared rate-limit storage.** The limiter keeps counters in memory, so with
  several API tasks each task counts separately. Redis fixes that.

## Data: what is stored and for how long

| Stored | Why |
|---|---|
| Email and an Argon2id password hash | Authentication |
| Document title, type, size, and the text of its chunks with their embeddings | Retrieval needs the text |
| Each question, its answer, citations, and the audit fields | History and auditability |

| Not stored | Why |
|---|---|
| The original uploaded file | Only the extracted text is needed |
| Passwords and API keys | Hashes only; keys live in the environment or in Secrets Manager |
| Prompts as sent | They can be rebuilt from the prompt version, the question and the retrieved chunk indexes |

**Retention.** Data is kept until the user deletes the document, which removes
its chunks and questions in the same transaction. There is no automatic expiry.
In production I would add a scheduled job that deletes documents older than a
configured number of days; every table already has `created_at`.

**What leaves the system.** Chunk text and questions are sent to the LLM
provider. On Gemini's free tier that content may be used to improve Google's
products, so this setup must not receive sensitive documents. The paid tier does
not use it that way.

## PII, logging and auditability

**PII.** The system does not detect or redact personal data. Documents are stored
as text and sent to the provider as they are. In production I would add a
redaction step at ingestion, before embedding, and encrypt the database at rest
(the Terraform already enables it) and in transit (the API connects to RDS with
TLS).

**Logging.** Logs are JSON, one object per line, and carry metadata only: user
ID, document ID, model, prompt version, token counts, latency and status. The
events are `question_answered`, `question_failed`, `document_ingested` and
`document_ingest_failed`. Document text, questions, answers and keys are never
logged, and tests assert it. Unexpected errors are logged without their message,
because the message of a failed database query contains its parameters.

**Auditability.** Every answer has a row in `questions` with the prompt version,
provider, model, token counts, latency and the chunks that were retrieved with
their distances. That is enough to explain why an answer was given and to
reproduce it.

### Observability

There are three kinds of data and each has one home:

| Data | Local | AWS |
|---|---|---|
| Event logs | Container output (`docker compose logs api`) | CloudWatch Logs, shipped by ECS |
| Audit records | `questions` table | The same table in RDS |
| Metrics | Queries on the audit table | CloudWatch metric filters on the logs |

Grafana is the visualization layer and stores nothing itself. Locally, an
optional profile starts it with a dashboard already loaded:

```bash
docker compose --profile observability up -d
# http://localhost:3002
```

The dashboard reads the audit table: questions per hour, answers by status,
latency p50 and p95, tokens, estimated cost, and a comparison by model and prompt
version. On AWS the same dashboard would run on Amazon Managed Grafana with two
data sources, CloudWatch and PostgreSQL. The Terraform creates the log groups,
three metric filters and a failure alarm; it does not create the Grafana
workspace, which needs an identity provider.

## Evaluation and reliability

This is not built. It is how I would do it.

**Measuring quality.** A golden set per document type: questions with their
expected answer and the passage that supports it, including questions the
document does not answer. Four measures:

| Measure | What it catches |
|---|---|
| Retrieval recall at 5: is the supporting passage among the retrieved ones? | Chunking and embedding problems |
| Citation precision: do the cited passages support the answer? | Answers that cite the wrong source |
| Answer correctness, graded by a stronger model against the expected answer | Wrong or incomplete answers |
| Refusal accuracy on the unanswerable questions | Hallucination when the document is silent |

**Detecting regressions.** A prompt change is a new version file and a model
change is a config change, so both are easy to run against the golden set before
they go live. The run would be a CI job that fails when a measure drops beyond a
threshold. In production, the dashboard's table by model and prompt version shows
the share of `not_found` and `unverified` answers, which moves when quality
moves.

**Handling a wrong answer.** A feedback control on each answer (not built) would
flag it. The audit row then shows the exact prompt version, model and retrieved
passages, which tells whether retrieval or generation failed. The case joins the
golden set, the fix ships as a new prompt version, and rolling back is a config
change.

## Infrastructure

The Terraform in [infra/](infra/) describes the deployment on AWS. It is
validated with `terraform validate` and has never been applied.

```
Internet -> ALB --/api/*--> API tasks (Fargate, private subnets) --> RDS PostgreSQL
                \--else---> Web tasks (Fargate, private subnets)
API tasks --> NAT gateway --> Gemini API
```

**Why ECS on Fargate.** The brief asks to show deployment on ECS, EKS or
serverless and to explain scaling under bursts. Fargate runs the same images as
local Compose, scales horizontally, injects secrets declaratively, and rolls back
a failed deployment. For a real MVP with few users a single EC2 instance running
Docker Compose would be cheaper, and I would start there.

**Secrets.** The API key and the JWT secret live in AWS Secrets Manager. Terraform
creates the secrets without values, which are set by hand, so they never reach the
repository or the Terraform state. The database password is generated and stored
by RDS. ECS injects all three when a task starts, and the task's execution role
can read only those three. Locally the key lives in `.env`, which git ignores.

**Rotation.** Create a new key at the provider, store it as a new secret version,
and force a new deployment. New tasks read the new value while old ones drain, so
there is no downtime, and the old key is revoked afterwards. The database password
can use the rotation RDS provides.

**Config versus code.** Provider, model names, prompt version and limits are
environment variables fed from Terraform variables. The same image runs in every
environment. The one exception is the frontend's API address, which Next.js
inlines at build time: the production image is built with
`NEXT_PUBLIC_API_URL=/api`.

**Scaling under bursty AI usage.**

- The API scales on requests per task, not CPU. A task waiting for the model is
  idle, so CPU does not reflect load.
- The real ceiling is the provider's quota, not our compute. More tasks do not
  help once the quota is reached; the answer there is a queue with backpressure
  and a clear "try again" to the user, which the API already returns as a 429.
- Requests are long. The load balancer's idle timeout is 120 seconds because one
  question can take up to about 96 seconds with retries.
- Cost follows tokens, not requests, so budgets must be counted in tokens.

## Trade-offs and known limitations

The design document lists every decision with the alternative I rejected and what
it costs: see
[section 13](docs/superpowers/specs/2026-10-03-document-qa-assistant-design.md).
The main ones:

| Decision | What it costs |
|---|---|
| RAG with pgvector instead of sending the whole document | Retrieval can miss the relevant passage |
| Own ports and adapters instead of LangChain | I maintain the chunker, retries and adapters |
| Independent questions | No follow-up questions |
| Status derived from citations | A valid citation shows the source was retrieved, not that the answer is faithful to it |
| Token in `localStorage` | A script on the page could read it |
| ECS Fargate | More moving parts and cost than one EC2 instance |

Known limitations:

- **Answer completeness.** An idea split across two chunks can produce an
  incomplete answer with a valid citation. Sending neighbouring chunks is the
  first improvement I would make.
- **Free tier.** About 500 questions per day and one large document per minute.
  Content sent may be used to improve Google's products.
- **Documents.** Text-based PDFs only. Tables and multi-column layouts extract
  poorly. PDF parsing runs on the request thread.
- **Sessions.** No refresh token; the session lasts one hour. A token for a
  deleted user is not rejected until it expires.
- **Rate limits.** Counters are in memory per task. Requests without a valid
  token are not counted. Login timing and the sign-up error reveal whether an
  email is registered.
- **Frontend.** No partial results without streaming. No security headers or
  content security policy. Long unbroken text can overflow an answer card. An
  oversized file is uploaded fully before the server rejects it.
- **Not built.** PII redaction, automatic data expiry, an evaluation suite, HTTPS
  on the load balancer (it needs a domain).
````

- [ ] **Step 3: Update the spec**

In the spec, section 10.2, add this row to the file table:

```markdown
| `observability.tf` | Log groups with retention, three metric filters on the JSON logs, one failure alarm |
```

In section 9, add these rows to the configuration table:

```markdown
| `DB_SSL` | `false` | |
| `TRUST_PROXY_HOPS` | `0` | |
```

In section 6.4, add at the end:

```markdown
Logs are JSON, one object per line, so CloudWatch metric filters and Grafana can
select by field.
```

In section 2, under "In scope", add:

```markdown
- An optional Grafana dashboard over the audit table, behind a Compose profile.
```

- [ ] **Step 4: Check every command in the README**

Run each command block of the README as written, against the running stack: "Run locally", "Try it", "Develop without Docker" (`pnpm test` and `pnpm test:int` in `apps/api`, `pnpm test` in `apps/web`) and the observability profile.

Expected: every command works without changes. Then confirm each "Explain" item of the brief has its section: prompt injection, cost and rate limits, data stored and retention, PII, logging, auditability, output quality, regressions, wrong answers, where keys live, rotation, scaling under bursts, and scaling constraints of AI workloads.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs
git commit -m "docs: complete the README with data, evaluation, cost and infrastructure sections"
```

---

### Task 5: Delivery checks

**Files:**
- None created. This task verifies the repository as someone else would receive it.

**Interfaces:**
- Consumes: the whole branch.
- Produces: evidence that a fresh clone runs, a final review, and a decision on how to merge and publish.

- [ ] **Step 1: Run from a clean clone**

The running stack uses the same ports, so stop it first. Its data is kept.

```bash
docker compose down
CLONE=$(mktemp -d)/docqa
git clone -q . "$CLONE" && cd "$CLONE" && git log --oneline -1
cp .env.example .env
perl -pi -e 's/^LLM_PROVIDER=gemini/LLM_PROVIDER=mock/' .env
docker compose -p docqa-clean up -d --build
curl -s --retry 30 --retry-all-errors --retry-delay 2 localhost:3001/api/health; echo
curl -s -o /dev/null -w 'web %{http_code}\n' localhost:3000/login
API=localhost:3001/api; J='Content-Type: application/json'
TOKEN=$(curl -s -X POST $API/auth/register -H "$J" -d '{"email":"clone@example.com","password":"correct-horse"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')
ID=$(curl -s -X POST $API/documents -H "Authorization: Bearer $TOKEN" -F 'file=@./docs/CHALLENGE.md' | sed 's/.*"id":"\([^"]*\)".*/\1/')
curl -s -X POST $API/documents/$ID/questions -H "Authorization: Bearer $TOKEN" -H "$J" -d '{"question":"Which backend technologies are allowed?"}' | cut -c1-200; echo
docker compose -p docqa-clean ps --format '{{.Service}} {{.Status}}'
```

Expected: the clone is at the branch head; health is `{"status":"ok"}`; `web 200`; the question returns `"status":"answered"`; three services are up, with `db` and `api` healthy.

Also confirm nothing private was cloned:

```bash
ls -a | grep -E "^\.env$|^\.superpowers$"; git ls-files | grep -E "\.env$|AGENTS\.md|CLAUDE\.md|\.terraform/"; echo "private files tracked: $?"
```

Expected: the first grep shows only the `.env` just created, and the second prints nothing with exit `1`.

- [ ] **Step 2: Tear down the clean stack and restore the original**

```bash
docker compose -p docqa-clean down -v
cd - > /dev/null && rm -rf "$CLONE"
docker compose up -d
curl -s --retry 30 --retry-all-errors --retry-delay 2 localhost:3001/api/health; echo
```

Expected: `{"status":"ok"}` from the original stack, with its data intact.

- [ ] **Step 3: Run every test suite once more**

```bash
(cd apps/api && pnpm lint && pnpm test && pnpm test:int)
(cd apps/web && pnpm lint && pnpm typecheck && pnpm test)
```

Expected: 90 unit and 8 integration tests in the API, 48 tests in the frontend, and clean lint and typecheck.

- [ ] **Step 4: Final review and handoff**

Follow the executing-plans skill: build the review package for this plan's range, dispatch one fresh reviewer on the most capable model with this plan's Review Focus, run one fix pass for Critical and Important findings with a failing test first, and list the rulings and deferred minors in the final message.

Then use superpowers:finishing-a-development-branch to decide, with the user, how to merge `feat/document-qa-assistant` into `main` and when to push. Pushing publishes the work, so it needs the user's explicit go-ahead.

**Checkpoint:** stop here. The deliverable is ready; what remains is the manual pass through the application and the decision to publish.
