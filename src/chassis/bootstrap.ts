import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { CloudEvent } from './cloudevent.js';
import { loadConfig, type ChassisConfig } from './config.js';
import { chassisMigrations, Db, type Migration, type Tx } from './db.js';
import { buildHttp } from './http.js';
import { claim } from './inbox.js';
import { createBus, type MessageBus, type SubscriptionSpec } from './messaging/index.js';
import { startOutboxRelay } from './outbox.js';

export type ModuleContext = {
  app: FastifyInstance;
  db: Db;
  bus: MessageBus;
  config: ChassisConfig;
  logger: FastifyBaseLogger;
};

export type Job = { name: string; everyMs: number; run: () => Promise<void> };

export type ModuleHooks = {
  /** Trata um evento assinado dentro da transação do inbox. */
  handle?: (event: CloudEvent, tx: Tx) => Promise<void>;
  jobs?: Job[];
  /** Roda depois que o serviço está ouvindo (ex.: seed). */
  onReady?: () => Promise<void>;
};

/** O que cada microsserviço declara. O chassis cuida do resto. */
export type ServiceModule = {
  name: string;
  defaultPort: number;
  migrations: Migration[];
  subscriptions: SubscriptionSpec[];
  register(ctx: ModuleContext): ModuleHooks | Promise<ModuleHooks>;
};

/**
 * Microservice chassis: HTTP, banco, migrações, barramento, outbox relay,
 * consumidor idempotente, jobs e desligamento gracioso. Igual em todos os
 * serviços Lagoski; o código de domínio fica no ServiceModule.
 */
export async function bootstrap(module: ServiceModule): Promise<void> {
  const config = loadConfig(module.name, module.defaultPort);
  const app = buildHttp(module.name);
  const logger = app.log;

  if (!config.databaseUrl) throw new Error('DATABASE_URL (ou DB_HOST/DB_USER/DB_PASSWORD/DB_NAME) é obrigatória');
  const db = new Db(config.databaseUrl, config.databaseSsl);
  await db.migrate([...chassisMigrations, ...module.migrations]);

  const bus = createBus(config, module.subscriptions, logger);
  bus.registerRoutes?.(app);
  app.get('/readyz', async (_req, reply) => ((await db.ping()) ? { status: 'ready' } : reply.code(503).send({ status: 'db-down' })));

  const hooks = await module.register({ app, db, bus, config, logger });

  if (module.subscriptions.length > 0) {
    if (!hooks.handle) throw new Error(`${module.name} assina tópicos mas não declarou handle()`);
    const handle = hooks.handle;
    await bus.subscriber.start(async ({ event, attempt, subscription }) => {
      const processed = await db.tx(async (tx) => {
        if (!(await claim(tx, module.name, event))) return false;
        await handle(event, tx);
        return true;
      });
      logger.info(
        { eventId: event.id, type: event.type, correlationId: event.correlationid, subscription, attempt, duplicate: !processed },
        processed ? 'evento processado' : 'evento duplicado ignorado (inbox)',
      );
    });
  }

  const stopRelay = startOutboxRelay(db, bus.publisher, logger, config.outboxIntervalMs);
  const timers = (hooks.jobs ?? []).map((job) => {
    let busy = false;
    return setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, 'job falhou');
      } finally {
        busy = false;
      }
    }, job.everyMs);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'desligando');
    timers.forEach(clearInterval);
    stopRelay();
    await bus.subscriber.stop();
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: config.port });
  logger.info({ provider: config.provider, prefix: config.prefix }, `${module.name} no ar`);
  await hooks.onReady?.();
}
