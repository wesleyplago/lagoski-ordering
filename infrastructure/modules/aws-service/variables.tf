variable "service_name" {
  description = "Nome do microsserviço (ex.: ordering). Também é o nome no Cloud Map."
  type        = string
}

variable "prefix" {
  description = "Prefixo dos recursos e dos nomes físicos de tópicos/filas (ex.: lagoski-dev)."
  type        = string
}

variable "image" {
  description = "Imagem do container (ECR), com tag imutável."
  type        = string
}

variable "container_port" {
  type = number
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "environment" {
  description = "Variáveis de ambiente extras do container."
  type        = map(string)
  default     = {}
}

variable "secret_env" {
  description = "Variáveis sensíveis (ex.: STRIPE_API_KEY). O módulo cria o secret vazio no Secrets Manager; o valor é gravado fora do Terraform para não ir ao state."
  type        = list(string)
  default     = []
}

variable "uses_database" {
  description = "Cria role/database próprios na instância compartilhada (via init container)."
  type        = bool
  default     = true
}

variable "publishes_topic" {
  description = "Tópico lógico em que o serviço publica (ex.: ordering.events). null se não publica."
  type        = string
  default     = null
}

variable "subscriptions" {
  description = "Assinaturas do serviço: tópico lógico e tipos de evento (lista vazia = sem filtro)."
  type = list(object({
    topic       = string
    event_types = list(string)
  }))
  default = []
}

variable "max_receive_count" {
  description = "Entregas antes de mover a mensagem para a DLQ."
  type        = number
  default     = 5
}

variable "public" {
  description = "Expõe o serviço no ALB da plataforma (só o BFF)."
  type        = bool
  default     = false
}

variable "public_path_patterns" {
  type    = list(string)
  default = ["/api/*"]
}

variable "listener_rule_priority" {
  type    = number
  default = 100
}

variable "platform" {
  description = "Saídas do lagoski-platform (terraform_remote_state)."
  type = object({
    vpc_id                         = string
    vpc_cidr                       = string
    private_subnet_ids             = list(string)
    ecs_cluster_arn                = string
    service_discovery_namespace_id = string
    service_discovery_domain       = string
    alb_listener_arn               = string
    alb_security_group_id          = string
    db_host                        = string
    db_port                        = number
    db_admin_username              = string
    db_admin_secret_arn            = string
    topic_arns                     = map(string)
    topic_arn_prefix               = string
  })
}

variable "tags" {
  type    = map(string)
  default = {}
}
