# Infraestrutura do lagoski-ordering

Terraform deste serviço, independente dos outros. Ele **lê** a base compartilhada
(rede, cluster, banco, tópicos) do state do
[lagoski-platform](https://github.com/wesleyplago/lagoski-platform) e **cria só o
que é dele**:

| Recurso | AWS | GCP |
| --- | --- | --- |
| Runtime | ECS Fargate (ARM64) + Cloud Map `ordering.lagoski.local` | Cloud Run (ingress interno) |
| Imagem | ECR `lagoski-dev-ordering` (tags imutáveis) | Artifact Registry da plataforma |
| Banco | role e database `ordering_db` criados por init container; senha no Secrets Manager | `google_sql_database` + `google_sql_user`; senha no Secret Manager |
| Publicação | `sns:Publish` só no tópico `ordering.events` | `roles/pubsub.publisher` só no tópico `ordering.events` |
| Assinaturas | 4 fila(s) SQS + DLQ + filtro SNS + alarme de DLQ | 4 push subscription(s) + dead-letter + filtro |

As assinaturas vêm de [`messaging.json`](../messaging.json), o mesmo arquivo que o código lê:
o filtro que o Terraform cria e o que o serviço espera receber não divergem.

```text
infrastructure/
├── modules/
│   ├── aws-service/        ECS, ECR, IAM, SQS/DLQ, assinaturas SNS, alarmes
│   └── gcp-service/        Cloud Run, IAM, Cloud SQL db/user, push subscriptions, dead-letter
└── environments/
    ├── aws/dev/            backend S3 (lockfile), remote state da plataforma
    └── gcp/dev/            backend GCS, remote state da plataforma
```

## Aplicar

Pré-requisito: o `lagoski-platform` aplicado no mesmo ambiente.

```bash
cd infrastructure/environments/aws/dev
cp backend.hcl.example backend.hcl   # ajuste o bucket
terraform init -backend-config=backend.hcl
terraform apply -var platform_state_bucket=<bucket> -var image=<ecr>/lagoski-dev-ordering:<sha>
```

```bash
cd infrastructure/environments/gcp/dev
cp backend.hcl.example backend.hcl
terraform init -backend-config=backend.hcl
terraform apply -var project_id=<projeto> -var platform_state_bucket=<bucket> -var image=<região>-docker.pkg.dev/<projeto>/lagoski/ordering:<sha>
```

No dia a dia, o deploy é o workflow **deploy** (manual, OIDC nas duas nuvens), que builda a
imagem com o SHA do commit e aplica o Terraform.

## Convenções

- Nomes físicos: `lagoski-<env>-<tópico>` e `lagoski-<env>-<serviço>-on-<contexto>`, iguais aos que o
  código calcula (`src/chassis/messaging/ports.ts`).
- State por serviço e por ambiente (`lagoski-ordering/<nuvem>/<env>`), nunca compartilhado.
- Tags/labels `project`, `service`, `environment`, `managed_by` em tudo.
- CI: `terraform fmt -check`, `validate` nos dois ambientes e `tflint` com os rulesets AWS e Google.
