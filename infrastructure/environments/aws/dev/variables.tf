variable "region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "image" {
  description = "Imagem no ECR com tag imutável (o pipeline passa o SHA do commit)."
  type        = string
}

variable "platform_state_bucket" {
  description = "Bucket S3 com o state do lagoski-platform."
  type        = string
}
