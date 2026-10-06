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
      # version followed by a new deployment. RDS also rotates its own password
      # every 7 days by default, which needs a redeployment too (see the README)
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
