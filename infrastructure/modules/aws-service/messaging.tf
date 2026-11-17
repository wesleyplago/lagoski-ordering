# O tópico é da plataforma (catálogo de tópicos); a fila, a DLQ e a assinatura
# são deste serviço: o consumidor decide o que recebe e como reprocessa.

locals {
  subscriptions = {
    for s in var.subscriptions :
    "${var.prefix}-${var.service_name}-on-${split(".", s.topic)[0]}" => s
  }
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = local.subscriptions
  name                      = "${each.key}-dlq"
  message_retention_seconds = 1209600 # 14 dias para inspecionar e reprocessar
  sqs_managed_sse_enabled   = true
  tags                      = var.tags
}

resource "aws_sqs_queue" "this" {
  for_each                   = local.subscriptions
  name                       = each.key
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = var.max_receive_count
  })
  tags = var.tags
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  for_each  = local.subscriptions
  queue_url = aws_sqs_queue.dlq[each.key].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.this[each.key].arn]
  })
}

data "aws_iam_policy_document" "queue" {
  for_each = local.subscriptions
  statement {
    sid       = "AllowSnsTopic"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.this[each.key].arn]
    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [var.platform.topic_arns[each.value.topic]]
    }
  }
}

resource "aws_sqs_queue_policy" "this" {
  for_each  = local.subscriptions
  queue_url = aws_sqs_queue.this[each.key].id
  policy    = data.aws_iam_policy_document.queue[each.key].json
}

resource "aws_sns_topic_subscription" "this" {
  for_each             = local.subscriptions
  topic_arn            = var.platform.topic_arns[each.value.topic]
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.this[each.key].arn
  raw_message_delivery = true
  filter_policy_scope  = length(each.value.event_types) > 0 ? "MessageAttributes" : null
  filter_policy        = length(each.value.event_types) > 0 ? jsonencode({ ce_type = each.value.event_types }) : null

  depends_on = [aws_sqs_queue_policy.this]
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  for_each            = local.subscriptions
  alarm_name          = "${each.key}-dlq-not-empty"
  alarm_description   = "Mensagens na DLQ de ${each.key}: investigar e reprocessar (redrive)."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq[each.key].name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}
