locals {
  db_name = replace("${var.service_name}_db", "-", "_")
  db_user = replace("${var.service_name}_svc", "-", "_")

  common_env = merge({
    PORT                 = tostring(var.container_port)
    MESSAGING_PROVIDER   = "aws"
    MESSAGING_PREFIX     = var.prefix
    SNS_TOPIC_ARN_PREFIX = var.platform.topic_arn_prefix
    AWS_REGION           = data.aws_region.current.name
    LOG_LEVEL            = "info"
  }, var.environment)

  db_env = var.uses_database ? {
    DB_HOST = var.platform.db_host
    DB_PORT = tostring(var.platform.db_port)
    DB_NAME = local.db_name
    DB_USER = local.db_user
    DB_SSL  = "true"
  } : {}

  db_secrets = var.uses_database ? [
    { name = "DB_PASSWORD", valueFrom = aws_secretsmanager_secret.db[0].arn },
  ] : []

  app_secrets = concat(local.db_secrets, [
    for name in var.secret_env : { name = name, valueFrom = aws_secretsmanager_secret.external[name].arn }
  ])

  log_config = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.this.name
      awslogs-region        = data.aws_region.current.name
      awslogs-stream-prefix = var.service_name
    }
  }

  # Init container: cria role e database do serviço com as credenciais de admin
  # e termina. O container principal só sobe se ele terminar com sucesso.
  init_container = var.uses_database ? [{
    name        = "db-init"
    image       = var.image
    essential   = false
    command     = ["node", "dist/db-init.js"]
    environment = [for k, v in merge(local.db_env, { DB_ADMIN_USER = var.platform.db_admin_username }) : { name = k, value = v }]
    secrets = concat(local.db_secrets, [
      { name = "DB_ADMIN_PASSWORD", valueFrom = "${var.platform.db_admin_secret_arn}:password::" },
    ])
    logConfiguration = local.log_config
  }] : []

  app_container = {
    name         = var.service_name
    image        = var.image
    essential    = true
    portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment  = [for k, v in merge(local.common_env, local.db_env) : { name = k, value = v }]
    secrets      = local.app_secrets
    dependsOn    = var.uses_database ? [{ containerName = "db-init", condition = "SUCCESS" }] : []
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.container_port}/healthz || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    logConfiguration = local.log_config
  }
}

data "aws_region" "current" {}

resource "aws_ecr_repository" "this" {
  name                 = "${var.prefix}-${var.service_name}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
  image_scanning_configuration {
    scan_on_push = true
  }
  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Mantém as 20 imagens mais recentes"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/lagoski/${var.prefix}/${var.service_name}"
  retention_in_days = 14
  tags              = var.tags
}

resource "random_password" "db" {
  count   = var.uses_database ? 1 : 0
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db" {
  count                   = var.uses_database ? 1 : 0
  name                    = "${var.prefix}/${var.service_name}/db-password"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "db" {
  count         = var.uses_database ? 1 : 0
  secret_id     = aws_secretsmanager_secret.db[0].id
  secret_string = random_password.db[0].result
}

# Segredos de terceiros (ex.: chave restrita do Stripe). Só o container; o
# valor é gravado com `aws secretsmanager put-secret-value` e nunca entra no state.
resource "aws_secretsmanager_secret" "external" {
  for_each                = toset(var.secret_env)
  name                    = "${var.prefix}/${var.service_name}/${lower(replace(each.value, "_", "-"))}"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_security_group" "service" {
  name        = "${var.prefix}-${var.service_name}"
  description = "Tarefas do ${var.service_name}"
  vpc_id      = var.platform.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "from_vpc" {
  security_group_id = aws_security_group.service.id
  description       = "HTTP de dentro da VPC (BFF e health checks)"
  cidr_ipv4         = var.platform.vpc_cidr
  from_port         = var.container_port
  to_port           = var.container_port
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_service_discovery_service" "this" {
  name = var.service_name
  dns_config {
    namespace_id   = var.platform.service_discovery_namespace_id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.prefix}-${var.service_name}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }
  container_definitions = jsonencode(concat(local.init_container, [local.app_container]))
  tags                  = var.tags
}

resource "aws_lb_target_group" "this" {
  count       = var.public ? 1 : 0
  name        = substr("${var.prefix}-${var.service_name}", 0, 32)
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.platform.vpc_id
  health_check {
    path    = "/healthz"
    matcher = "200"
  }
  # SSE: conexões longas.
  deregistration_delay = 10
  tags                 = var.tags
}

resource "aws_lb_listener_rule" "this" {
  count        = var.public ? 1 : 0
  listener_arn = var.platform.alb_listener_arn
  priority     = var.listener_rule_priority
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[0].arn
  }
  condition {
    path_pattern {
      values = var.public_path_patterns
    }
  }
  tags = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "from_alb" {
  count                        = var.public ? 1 : 0
  security_group_id            = aws_security_group.service.id
  description                  = "Tráfego do ALB público"
  referenced_security_group_id = var.platform.alb_security_group_id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

resource "aws_ecs_service" "this" {
  name                   = var.service_name
  cluster                = var.platform.ecs_cluster_arn
  task_definition        = aws_ecs_task_definition.this.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets         = var.platform.private_subnet_ids
    security_groups = [aws_security_group.service.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.this.arn
  }

  dynamic "load_balancer" {
    for_each = var.public ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.this[0].arn
      container_name   = var.service_name
      container_port   = var.container_port
    }
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = var.tags

  depends_on = [aws_lb_listener_rule.this]
}
