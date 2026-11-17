export type Provider = 'aws' | 'gcp' | 'memory';

export type ChassisConfig = {
  service: string;
  port: number;
  provider: Provider;
  /** Prefixo dos nomes físicos de tópicos e filas, ex.: `lagoski-dev`. */
  prefix: string;
  databaseUrl: string | undefined;
  databaseSsl: boolean;
  outboxIntervalMs: number;
  aws: {
    region: string;
    /** Só em dev (LocalStack). */
    endpoint: string | undefined;
    /** Ex.: `arn:aws:sns:us-east-1:123456789012:` */
    topicArnPrefix: string | undefined;
  };
  gcp: {
    projectId: string | undefined;
    /** Audience do token OIDC enviado pelo push do Pub/Sub. */
    pushAudience: string | undefined;
    verifyPush: boolean;
  };
};

export const readEnv = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

function databaseUrlFromParts(): string | undefined {
  const host = readEnv('DB_HOST');
  if (!host) return undefined;
  const user = encodeURIComponent(readEnv('DB_USER') ?? '');
  const password = encodeURIComponent(readEnv('DB_PASSWORD') ?? '');
  return `postgres://${user}:${password}@${host}:${readEnv('DB_PORT') ?? '5432'}/${readEnv('DB_NAME') ?? ''}`;
}

export function loadConfig(service: string, defaultPort: number): ChassisConfig {
  const provider = (readEnv('MESSAGING_PROVIDER') ?? 'memory') as Provider;
  if (!['aws', 'gcp', 'memory'].includes(provider)) {
    throw new Error(`MESSAGING_PROVIDER inválido: ${provider} (use aws, gcp ou memory)`);
  }
  return {
    service,
    port: Number(readEnv('PORT') ?? defaultPort),
    provider,
    prefix: readEnv('MESSAGING_PREFIX') ?? 'lagoski-dev',
    // DATABASE_URL tem prioridade; na nuvem a URL é montada a partir de DB_* (senha vem de secret).
    databaseUrl: readEnv('DATABASE_URL') ?? databaseUrlFromParts(),
    databaseSsl: readEnv('DB_SSL') === 'true',
    outboxIntervalMs: Number(readEnv('OUTBOX_INTERVAL_MS') ?? 500),
    aws: {
      region: readEnv('AWS_REGION') ?? 'us-east-1',
      endpoint: readEnv('AWS_ENDPOINT_URL'),
      topicArnPrefix: readEnv('SNS_TOPIC_ARN_PREFIX'),
    },
    gcp: {
      projectId: readEnv('GCP_PROJECT_ID'),
      pushAudience: readEnv('PUBSUB_PUSH_AUDIENCE'),
      verifyPush: readEnv('PUBSUB_VERIFY_PUSH') !== 'false',
    },
  };
}
