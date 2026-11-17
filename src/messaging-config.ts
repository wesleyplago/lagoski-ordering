import { readFileSync } from 'node:fs';
import type { SubscriptionSpec } from './chassis/messaging/ports.js';

type RawMessaging = {
  publishes: string | null;
  subscriptions: Array<{ topic: string; event_types: string[] }>;
};

/**
 * Lê messaging.json, o mesmo arquivo que o Terraform usa para criar filas,
 * assinaturas e filtros. Código e infraestrutura não divergem.
 */
const raw = JSON.parse(readFileSync(new URL('../messaging.json', import.meta.url), 'utf8')) as RawMessaging;

export const publishes = raw.publishes;
export const subscriptions: SubscriptionSpec[] = raw.subscriptions.map((s) => ({ topic: s.topic, eventTypes: s.event_types }));
