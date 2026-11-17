import type { CloudEvent } from '../cloudevent.js';
import {
  matches,
  subscriptionPhysicalName,
  type DeliveryHandler,
  type MessageBus,
  type SubscriptionSpec,
} from './ports.js';

export type MemoryBus = MessageBus & {
  /** Tudo que o serviço publicou, na ordem. */
  readonly published: Array<{ topic: string; event: CloudEvent }>;
  /** Simula o broker entregando um evento externo (testes e dev isolado). */
  inject(topic: string, event: CloudEvent): Promise<boolean>;
};

/** Barramento em processo: para testes e para rodar um serviço sozinho, sem nuvem. */
export function createMemoryBus(service: string, subscriptions: SubscriptionSpec[], prefix = 'lagoski-dev'): MemoryBus {
  const published: Array<{ topic: string; event: CloudEvent }> = [];
  let handler: DeliveryHandler | null = null;

  return {
    provider: 'memory',
    published,
    publisher: {
      async publish(topic, event) {
        published.push({ topic, event });
      },
    },
    subscriber: {
      async start(next) {
        handler = next;
      },
      async stop() {
        handler = null;
      },
    },
    async inject(topic, event) {
      const spec = subscriptions.find((s) => s.topic === topic && matches(s, event.type));
      if (!spec || !handler) return false;
      await handler({ event, attempt: 1, subscription: subscriptionPhysicalName(prefix, service, topic) });
      return true;
    },
  };
}
