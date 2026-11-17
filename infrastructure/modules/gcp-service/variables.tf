variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "service_name" {
  type = string
}

variable "prefix" {
  description = "Prefixo dos recursos e dos nomes físicos de tópicos/assinaturas (ex.: lagoski-dev)."
  type        = string
}

variable "image" {
  description = "Imagem no Artifact Registry, com tag imutável."
  type        = string
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "min_instances" {
  type    = number
  default = 0
}

variable "max_instances" {
  type    = number
  default = 3
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secret_env" {
  description = "Variáveis sensíveis (ex.: STRIPE_API_KEY). O módulo cria o secret sem versão; o valor é adicionado fora do Terraform."
  type        = list(string)
  default     = []
}

variable "uses_database" {
  type    = bool
  default = true
}

variable "publishes_topic" {
  type    = string
  default = null
}

variable "subscriptions" {
  type = list(object({
    topic       = string
    event_types = list(string)
  }))
  default = []
}

variable "max_delivery_attempts" {
  type    = number
  default = 5
}

variable "public" {
  description = "Aceita tráfego da internet sem autenticação (só o BFF)."
  type        = bool
  default     = false
}

variable "vpc_egress" {
  description = "ALL_TRAFFIC faz chamadas a *.run.app passarem pela VPC (necessário para o BFF chamar serviços internos)."
  type        = string
  default     = "PRIVATE_RANGES_ONLY"
}

variable "runtime_service_account_email" {
  description = "Conta de serviço já existente para o runtime (o BFF usa a da plataforma). null cria uma."
  type        = string
  default     = null
}

variable "platform" {
  description = "Saídas do lagoski-platform (terraform_remote_state)."
  type = object({
    network_id                = string
    subnet_id                 = string
    sql_instance_name         = string
    sql_private_ip            = string
    topic_ids                 = map(string)
    pubsub_service_agent      = string
    bff_service_account_email = string
  })
}

variable "labels" {
  type    = map(string)
  default = {}
}
