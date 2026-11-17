output "url" {
  description = "URL do Cloud Run (interna, exceto no BFF)."
  value       = google_cloud_run_v2_service.this.uri
}

output "runtime_service_account" {
  value = local.runtime_sa
}

output "subscriptions" {
  value = { for name, s in google_pubsub_subscription.this : name => { id = s.id, dead_letter = google_pubsub_subscription.dead_letter[name].id } }
}
