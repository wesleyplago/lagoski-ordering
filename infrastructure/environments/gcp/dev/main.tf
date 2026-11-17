locals {
  messaging = jsondecode(file("${path.module}/../../../../messaging.json"))
  platform  = data.terraform_remote_state.platform.outputs.service_platform

  labels = {
    project     = "lagoski"
    service     = "ordering"
    environment = var.environment
    managed_by  = "terraform"
  }
}

data "terraform_remote_state" "platform" {
  backend = "gcs"
  config = {
    bucket = var.platform_state_bucket
    prefix = "lagoski-platform/gcp/${var.environment}"
  }
}

module "service" {
  source = "../../../modules/gcp-service"

  project_id      = var.project_id
  region          = var.region
  service_name    = "ordering"
  prefix          = "lagoski-${var.environment}"
  image           = var.image
  container_port  = 8082
  uses_database   = true
  publishes_topic = local.messaging.publishes
  subscriptions   = local.messaging.subscriptions

  platform = local.platform
  labels   = local.labels
}
