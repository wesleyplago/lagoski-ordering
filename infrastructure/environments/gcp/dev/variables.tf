variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "southamerica-east1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "image" {
  description = "Imagem no Artifact Registry com tag imutável."
  type        = string
}

variable "platform_state_bucket" {
  description = "Bucket GCS com o state do lagoski-platform."
  type        = string
}
