# Uma push subscription por tópico assinado, com filtro por ce_type, retry com
# backoff exponencial e dead-letter topic próprio. O tópico é da plataforma.

locals {
  subscriptions = {
    for s in var.subscriptions :
    "${var.prefix}-${var.service_name}-on-${split(".", s.topic)[0]}" => s
  }
}

resource "google_service_account" "push" {
  count        = length(local.subscriptions) > 0 ? 1 : 0
  project      = var.project_id
  account_id   = substr("${var.prefix}-${var.service_name}-push", 0, 30)
  display_name = "Pub/Sub push para ${var.service_name}"
}

resource "google_cloud_run_v2_service_iam_member" "push" {
  count    = length(local.subscriptions) > 0 ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.push[0].email}"
}

# O agente do Pub/Sub precisa emitir o token OIDC em nome da conta de push.
resource "google_service_account_iam_member" "push_token_creator" {
  count              = length(local.subscriptions) > 0 ? 1 : 0
  service_account_id = google_service_account.push[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${var.platform.pubsub_service_agent}"
}

resource "google_pubsub_topic" "dead_letter" {
  for_each = local.subscriptions
  project  = var.project_id
  name     = "${each.key}-dlq"
  labels   = var.labels
}

# Assinatura pull no dead-letter para inspecionar e reprocessar.
resource "google_pubsub_subscription" "dead_letter" {
  for_each                   = local.subscriptions
  project                    = var.project_id
  name                       = "${each.key}-dlq"
  topic                      = google_pubsub_topic.dead_letter[each.key].id
  message_retention_duration = "1209600s"
  labels                     = var.labels
}

resource "google_pubsub_subscription" "this" {
  for_each = local.subscriptions
  project  = var.project_id
  name     = each.key
  topic    = var.platform.topic_ids[each.value.topic]
  labels   = var.labels

  # Filtro é imutável: mudar a lista de tipos recria a assinatura.
  filter = length(each.value.event_types) > 0 ? join(" OR ", [
    for t in each.value.event_types : "attributes.ce_type = \"${t}\""
  ]) : null

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter[each.key].id
    max_delivery_attempts = var.max_delivery_attempts
  }

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.this.uri}/_events/pubsub"
    oidc_token {
      service_account_email = google_service_account.push[0].email
      audience              = google_cloud_run_v2_service.this.uri
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.push, google_service_account_iam_member.push_token_creator]
}

# Para o dead-letter funcionar, o agente do Pub/Sub publica no DLQ e confirma na origem.
resource "google_pubsub_topic_iam_member" "dlq_publisher" {
  for_each = local.subscriptions
  project  = var.project_id
  topic    = google_pubsub_topic.dead_letter[each.key].name
  role     = "roles/pubsub.publisher"
  member   = "serviceAccount:${var.platform.pubsub_service_agent}"
}

resource "google_pubsub_subscription_iam_member" "source_subscriber" {
  for_each     = local.subscriptions
  project      = var.project_id
  subscription = google_pubsub_subscription.this[each.key].name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${var.platform.pubsub_service_agent}"
}
