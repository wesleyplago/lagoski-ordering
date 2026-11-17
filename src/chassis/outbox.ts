import type { FastifyBaseLogger } from 'fastify';
import type { CloudEvent } from './cloudevent.js';
import type { Db, Tx } from './db.js';
import type { EventPublisher } from './messaging/ports.js';

/**
 * Transactional Outbox: o evento é gravado na mesma transação do agregado.
 * Nunca publicamos direto do caso de uso (dual-write).
 */
export async function enqueue(tx: Tx, topic: string, event: CloudEvent): Promise<void> {
  await tx.query('insert into outbox (id, topic, event) values ($1, $2, $3)', [event.id, topic, JSON.stringify(event)]);
}

/**
 * Relay: lê o outbox e publica no broker. `for update skip locked` deixa várias
 * réplicas trabalharem sem publicar a mesma linha ao mesmo tempo. Se o processo
 * cair entre publicar e marcar, o evento sai de novo: entrega é at-least-once e
 * os consumidores são idempotentes (inbox).
 */
export function startOutboxRelay(db: Db, publisher: EventPublisher, logger: FastifyBaseLogger, intervalMs: number) {
  const batch = 50;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const sent = await db.tx(async (tx) => {
          const { rows } = await tx.query<{ id: string; topic: string; event: CloudEvent }>(
            `select id, topic, event from outbox
              where published_at is null
              order by created_at
              limit $1
              for update skip locked`,
            [batch],
          );
          for (const row of rows) {
            await publisher.publish(row.topic, row.event);
            await tx.query('update outbox set published_at = now() where id = $1', [row.id]);
            logger.debug({ eventId: row.id, type: row.event.type, topic: row.topic }, 'evento publicado');
          }
          return rows.length;
        });
        if (sent < batch) break;
      }
    } catch (err) {
      logger.error({ err }, 'relay do outbox falhou; tenta de novo no próximo ciclo');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
