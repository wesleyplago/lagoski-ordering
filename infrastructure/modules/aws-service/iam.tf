data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: o agente do ECS puxa a imagem, escreve logs e injeta secrets.
resource "aws_iam_role" "execution" {
  name               = "${var.prefix}-${var.service_name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

locals {
  readable_secrets = concat(
    var.uses_database ? [aws_secretsmanager_secret.db[0].arn, var.platform.db_admin_secret_arn] : [],
    [for s in aws_secretsmanager_secret.external : s.arn],
  )
}

data "aws_iam_policy_document" "execution_secrets" {
  count = length(local.readable_secrets) > 0 ? 1 : 0
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.readable_secrets
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  count  = length(local.readable_secrets) > 0 ? 1 : 0
  name   = "read-db-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets[0].json
}

# Task role: o que o código pode fazer. Só publica no próprio tópico e só lê as próprias filas.
resource "aws_iam_role" "task" {
  name               = "${var.prefix}-${var.service_name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "task" {
  dynamic "statement" {
    for_each = var.publishes_topic == null ? [] : [var.publishes_topic]
    content {
      sid       = "PublishOwnTopic"
      actions   = ["sns:Publish"]
      resources = [var.platform.topic_arns[statement.value]]
    }
  }

  dynamic "statement" {
    for_each = length(local.subscriptions) == 0 ? [] : [1]
    content {
      sid = "ConsumeOwnQueues"
      actions = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes",
      ]
      resources = [for q in aws_sqs_queue.this : q.arn]
    }
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "service"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}
