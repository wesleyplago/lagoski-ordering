output "ecr_repository_url" {
  value = aws_ecr_repository.this.repository_url
}

output "internal_url" {
  description = "URL interna (Cloud Map) usada pelo BFF."
  value       = "http://${var.service_name}.${var.platform.service_discovery_domain}:${var.container_port}"
}

output "queues" {
  description = "Filas e DLQs por assinatura."
  value = {
    for name, q in aws_sqs_queue.this : name => {
      url     = q.url
      dlq_url = aws_sqs_queue.dlq[name].url
    }
  }
}

output "ecs_service_name" {
  value = aws_ecs_service.this.name
}
