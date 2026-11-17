import { PubSub, type Topic } from '@google-cloud/pubsub';
import type { FastifyBaseLogger } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { messageAttributes, parseEvent } from '../cloudevent.js';
import {
  subscriptionPhysicalName,
  topicPhysicalName,
  type DeliveryHandler,
  type MessageBus,
  type SubscriptionSpec,
} from './ports.js';

type GcpBusOptions = {
  projectId: string | undefined;
  prefix: string;
  service: string;
  subscriptions: SubscriptionSpec[];
  pushAudience: string | undefined;
  verifyPush: boolean;
  logger: FastifyBaseLogger;
};

/** Corpo que o Pub/Sub envia numa push subscription. */
const PushBodySchema = z.object({
  message: z.object({
    data: z.string(),
    attributes: z.record(z.string(), z.string()).optional(),
    messageId: z.string(),
  }),
  subscription: z.string(),
  deliveryAttempt: z.number().int().optional(),
});

export const PUSH_PATH = '/_events/pubsub';

/**
 * Pub/Sub com push subscriptions: o broker chama o serviço (Cloud Run pode
 * escalar a zero). 2xx confirma; qualquer outro status faz o Pub/Sub tentar de
 * novo com backoff e, depois de max_delivery_attempts, mandar para o dead-letter.
 */
export function createGcpBus(options: GcpBusOptions): MessageBus {
  const pubsub = new PubSub(options.projectId ? { projectId: options.projectId } : {});
  const topics = new Map<string, Topic>();
  const known = new Set(
    options.subscriptions.map((spec) => subscriptionPhysicalName(options.prefix, options.service, spec.topic)),
  );
  const oidc = new OAuth2Client();
  let handler: DeliveryHandler | null = null;

  const topicFor = (logical: string): Topic => {
    const name = topicPhysicalName(options.prefix, logical);
    let topic = topics.get(name);
    if (!topic) {
      topic = pubsub.topic(name);
      topics.set(name, topic);
    }
    return topic;
  };

  return {
    provider: 'gcp',
    publisher: {
      async publish(topic, event) {
        await topicFor(topic).publishMessage({
          data: Buffer.from(JSON.stringify(event)),
          attributes: messageAttributes(event),
        });
      },
    },
    subscriber: {
      async start(next) {
        handler = next;
        options.logger.info({ subscriptions: [...known] }, 'aguardando push do Pub/Sub');
      },
      async stop() {
        handler = null;
      },
    },
    registerRoutes(app) {
      app.post(PUSH_PATH, async (request, reply) => {
        if (!handler) return reply.code(503).send({ error: 'NOT_READY' });
        if (options.verifyPush) {
          const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
          if (!token) return reply.code(401).send({ error: 'MISSING_TOKEN' });
          try {
            await oidc.verifyIdToken({ idToken: token, audience: options.pushAudience });
          } catch {
            return reply.code(401).send({ error: 'INVALID_TOKEN' });
          }
        }
        const body = PushBodySchema.parse(request.body);
        const subscription = body.subscription.split('/').pop() ?? '';
        if (!known.has(subscription)) return reply.code(404).send({ error: 'UNKNOWN_SUBSCRIPTION' });
        const event = parseEvent(Buffer.from(body.message.data, 'base64').toString('utf8'));
        await handler({ event, attempt: body.deliveryAttempt ?? 1, subscription });
        return reply.code(204).send();
      });
    },
  };
}
