import { ulid } from 'ulid';
import { z } from 'zod';

/** Envelope CloudEvents 1.0 (modo estruturado, JSON). */
export const CloudEventSchema = z.object({
  specversion: z.literal('1.0'),
  id: z.string().min(1),
  source: z.string().min(1),
  type: z.string().min(1),
  subject: z.string().optional(),
  time: z.string().min(1),
  datacontenttype: z.literal('application/json'),
  dataschema: z.string().optional(),
  correlationid: z.string().min(1),
  causationid: z.string().optional(),
  traceparent: z.string().optional(),
  data: z.unknown(),
});

export type CloudEvent<T = unknown> = Omit<z.infer<typeof CloudEventSchema>, 'data'> & { data: T };

export type NewEventInput<T> = {
  source: string;
  type: string;
  data: T;
  subject?: string;
  /** Normalmente o id do pedido: liga todos os eventos da mesma saga. */
  correlationId: string;
  /** Evento que causou este (vira `causationid` e propaga o `traceparent`). */
  causedBy?: Pick<CloudEvent, 'id' | 'traceparent'>;
};

export function newEvent<T>(input: NewEventInput<T>): CloudEvent<T> {
  return {
    specversion: '1.0',
    id: ulid(),
    source: input.source,
    type: input.type,
    subject: input.subject,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    correlationid: input.correlationId,
    causationid: input.causedBy?.id,
    traceparent: input.causedBy?.traceparent,
    data: input.data,
  };
}

/**
 * Atributos da mensagem no broker. Os filtros de assinatura (SNS filter policy
 * e filtro do Pub/Sub) olham só para eles, nunca para o corpo.
 */
export function messageAttributes(event: CloudEvent): Record<string, string> {
  const attrs: Record<string, string> = {
    ce_type: event.type,
    ce_source: event.source,
    ce_id: event.id,
    correlation_id: event.correlationid,
  };
  if (event.traceparent) attrs.traceparent = event.traceparent;
  return attrs;
}

/** Lança se o corpo não for um CloudEvent válido (mensagem envenenada → retry → DLQ). */
export function parseEvent(raw: string): CloudEvent {
  return CloudEventSchema.parse(JSON.parse(raw)) as CloudEvent;
}
