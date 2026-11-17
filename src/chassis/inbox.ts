import type { CloudEvent } from './cloudevent.js';
import type { Tx } from './db.js';

/**
 * Idempotent Consumer: registra o id do evento na mesma transação do efeito.
 * Devolve false se o evento já foi processado (entrega duplicada do broker).
 */
export async function claim(tx: Tx, consumer: string, event: CloudEvent): Promise<boolean> {
  const result = await tx.query(
    `insert into inbox (consumer, event_id, event_type) values ($1, $2, $3)
     on conflict (consumer, event_id) do nothing`,
    [consumer, event.id, event.type],
  );
  return (result.rowCount ?? 0) > 0;
}
