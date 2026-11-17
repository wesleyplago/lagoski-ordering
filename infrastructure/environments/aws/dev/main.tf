locals {
  # Fonte única: o mesmo arquivo que o código lê na subida.
  messaging = jsondecode(file("${path.module}/../../../../messaging.json"))
  platform  = data.terraform_remote_state.platform.outputs.service_platform

  tags = {
    project     = "lagoski"
    service     = "ordering"
    environment = var.environment
    repository  = "wesleyplago/lagoski-ordering"
    managed_by  = "terraform"
  }
}

data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = var.platform_state_bucket
    key    = "lagoski-platform/aws/${var.environment}/terraform.tfstate"
    region = var.region
  }
}

module "service" {
  source = "../../../modules/aws-service"

  service_name    = "ordering"
  prefix          = "lagoski-${var.environment}"
  image           = var.image
  container_port  = 8082
  uses_database   = true
  publishes_topic = local.messaging.publishes
  subscriptions   = local.messaging.subscriptions

  platform = local.platform
  tags     = local.tags
}
