import type { FastifyInstance } from 'fastify';
import type { CloudEvent } from '../cloudevent.js';

/** Uma assinatura lógica: de qual tópico e quais tipos de evento (vazio = todos). */
export type SubscriptionSpec = {
  topic: string;
  eventTypes: string[];
};

export type Delivery = {
  event: CloudEvent;
  /** 1 na primeira entrega; cresce a cada retry do broker. */
  attempt: number;
  /** Nome físico da assinatura/fila. */
  subscription: string;
};

export type DeliveryHandler = (delivery: Delivery) => Promise<void>;

export interface EventPublisher {
  publish(topic: string, event: CloudEvent): Promise<void>;
}

export interface EventSubscriber {
  /** Começa a entregar mensagens ao handler. Lançar no handler = não confirmar (o broker reentrega). */
  start(handler: DeliveryHandler): Promise<void>;
  stop(): Promise<void>;
}

export interface MessageBus {
  readonly provider: 'aws' | 'gcp' | 'memory';
  readonly publisher: EventPublisher;
  readonly subscriber: EventSubscriber;
  /** Rotas HTTP que o adapter precisa (ex.: endpoint de push do Pub/Sub). */
  registerRoutes?(app: FastifyInstance): void;
}

/** `ordering.events` → `lagoski-dev-ordering-events`. O Terraform usa a mesma regra. */
export const topicPhysicalName = (prefix: string, topic: string): string =>
  `${prefix}-${topic.replace(/\./g, '-')}`;

/** Inventory assinando `ordering.events` → `lagoski-dev-inventory-on-ordering`. */
export const subscriptionPhysicalName = (prefix: string, service: string, topic: string): string =>
  `${prefix}-${service}-on-${topic.split('.')[0]}`;

/** Filtro por tipo, igual ao que o broker aplica (usado no adapter em memória). */
export const matches = (spec: SubscriptionSpec, eventType: string): boolean =>
  spec.eventTypes.length === 0 || spec.eventTypes.includes(eventType);
