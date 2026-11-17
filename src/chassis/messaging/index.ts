import type { FastifyBaseLogger } from 'fastify';
import type { ChassisConfig } from '../config.js';
import { createAwsBus } from './aws.js';
import { createGcpBus } from './gcp.js';
import { createMemoryBus } from './memory.js';
import type { MessageBus, SubscriptionSpec } from './ports.js';

export * from './ports.js';

/** Escolhe o adapter pela configuração. O domínio só conhece as portas. */
export function createBus(config: ChassisConfig, subscriptions: SubscriptionSpec[], logger: FastifyBaseLogger): MessageBus {
  switch (config.provider) {
    case 'aws': {
      if (!config.aws.topicArnPrefix) throw new Error('SNS_TOPIC_ARN_PREFIX é obrigatória com MESSAGING_PROVIDER=aws');
      return createAwsBus({
        region: config.aws.region,
        endpoint: config.aws.endpoint,
        topicArnPrefix: config.aws.topicArnPrefix,
        prefix: config.prefix,
        service: config.service,
        subscriptions,
        logger,
      });
    }
    case 'gcp':
      return createGcpBus({
        projectId: config.gcp.projectId,
        prefix: config.prefix,
        service: config.service,
        subscriptions,
        pushAudience: config.gcp.pushAudience,
        verifyPush: config.gcp.verifyPush,
        logger,
      });
    case 'memory':
      return createMemoryBus(config.service, subscriptions, config.prefix);
  }
}
