locals {
  db_name = replace("${var.service_name}_db", "-", "_")
  db_user = replace("${var.service_name}_svc", "-", "_")

  runtime_sa = var.runtime_service_account_email != null ? var.runtime_service_account_email : google_service_account.runtime[0].email

  env = merge({
    MESSAGING_PROVIDER = "gcp"
    MESSAGING_PREFIX   = var.prefix
    GCP_PROJECT_ID     = var.project_id
    LOG_LEVEL          = "info"
    }, var.uses_database ? {
    DB_HOST = var.platform.sql_private_ip
    DB_PORT = "5432"
    DB_NAME = local.db_name
    DB_USER = local.db_user
  } : {}, var.environment)
}

resource "google_service_account" "runtime" {
  count        = var.runtime_service_account_email == null ? 1 : 0
  project      = var.project_id
  account_id   = substr("${var.prefix}-${var.service_name}", 0, 30)
  display_name = "Lagoski ${var.service_name} (runtime)"
}

# Banco próprio na instância compartilhada. No GCP a API do Cloud SQL cria
# database e usuário; na AWS isso é feito pelo init container.
resource "random_password" "db" {
  count   = var.uses_database ? 1 : 0
  length  = 32
  special = false
}

resource "google_sql_database" "this" {
  count    = var.uses_database ? 1 : 0
  project  = var.project_id
  instance = var.platform.sql_instance_name
  name     = local.db_name
}

resource "google_sql_user" "this" {
  count    = var.uses_database ? 1 : 0
  project  = var.project_id
  instance = var.platform.sql_instance_name
  name     = local.db_user
  password = random_password.db[0].result
}

resource "google_secret_manager_secret" "db" {
  count     = var.uses_database ? 1 : 0
  project   = var.project_id
  secret_id = "${var.prefix}-${var.service_name}-db-password"
  replication {
    auto {}
  }
  labels = var.labels
}

resource "google_secret_manager_secret_version" "db" {
  count       = var.uses_database ? 1 : 0
  secret      = google_secret_manager_secret.db[0].id
  secret_data = random_password.db[0].result
}

resource "google_secret_manager_secret_iam_member" "db" {
  count     = var.uses_database ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.db[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa}"
}

# Segredos de terceiros (ex.: chave restrita do Stripe): o valor é adicionado com
# `gcloud secrets versions add` e nunca entra no state.
resource "google_secret_manager_secret" "external" {
  for_each  = toset(var.secret_env)
  project   = var.project_id
  secret_id = "${var.prefix}-${var.service_name}-${lower(replace(each.value, "_", "-"))}"
  replication {
    auto {}
  }
  labels = var.labels
}

resource "google_secret_manager_secret_iam_member" "external" {
  for_each  = toset(var.secret_env)
  project   = var.project_id
  secret_id = google_secret_manager_secret.external[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa}"
}

resource "google_pubsub_topic_iam_member" "publisher" {
  count   = var.publishes_topic == null ? 0 : 1
  project = var.project_id
  topic   = var.platform.topic_ids[var.publishes_topic]
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${local.runtime_sa}"
}

resource "google_cloud_run_v2_service" "this" {
  project             = var.project_id
  name                = "${var.prefix}-${var.service_name}"
  location            = var.region
  ingress             = var.public ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = false
  labels              = var.labels

  template {
    service_account = local.runtime_sa
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # Direct VPC egress: alcança o IP privado do Cloud SQL e os outros serviços internos.
    vpc_access {
      egress = var.vpc_egress
      network_interfaces {
        network    = var.platform.network_id
        subnetwork = var.platform.subnet_id
      }
    }

    containers {
      image = var.image
      ports {
        container_port = var.container_port
      }
      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # O relay do outbox e os jobs rodam em background: CPU sempre alocada.
        cpu_idle = false
      }

      dynamic "env" {
        for_each = local.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.uses_database ? [1] : []
        content {
          name = "DB_PASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.db[0].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = toset(var.secret_env)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.external[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.db,
    google_secret_manager_secret_iam_member.external,
    google_secret_manager_secret_version.db,
    google_sql_user.this,
  ]
}

# Quem pode chamar: o BFF (HTTP) e a conta de push do Pub/Sub. Público só o BFF.
resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.public ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "bff" {
  count    = var.public ? 0 : 1
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.platform.bff_service_account_email}"
}
