import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type { FastifyBaseLogger } from 'fastify';
import { messageAttributes, parseEvent } from '../cloudevent.js';
import {
  subscriptionPhysicalName,
  topicPhysicalName,
  type DeliveryHandler,
  type MessageBus,
  type SubscriptionSpec,
} from './ports.js';

type AwsBusOptions = {
  region: string;
  endpoint: string | undefined;
  topicArnPrefix: string;
  prefix: string;
  service: string;
  subscriptions: SubscriptionSpec[];
  logger: FastifyBaseLogger;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * SNS (fan-out com filter policy) + SQS (uma fila por assinatura, com DLQ via
 * redrive). Consumo por long polling: o serviço puxa as mensagens.
 */
export function createAwsBus(options: AwsBusOptions): MessageBus {
  const clientConfig = { region: options.region, ...(options.endpoint ? { endpoint: options.endpoint } : {}) };
  const sns = new SNSClient(clientConfig);
  const sqs = new SQSClient(clientConfig);
  const abort = new AbortController();
  const loops: Promise<void>[] = [];
  const log = options.logger;

  async function poll(queueUrl: string, name: string, handler: DeliveryHandler): Promise<void> {
    while (!abort.signal.aborted) {
      try {
        const result = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
          { abortSignal: abort.signal },
        );
        for (const message of result.Messages ?? []) {
          const attempt = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
          try {
            await handler({ event: parseEvent(message.Body ?? ''), attempt, subscription: name });
            await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
          } catch (err) {
            // Não apaga: a mensagem volta para a fila com backoff e, depois de
            // maxReceiveCount tentativas, o SQS move para a DLQ.
            const backoff = Math.min(300, 5 * 2 ** attempt);
            log.warn({ err, subscription: name, attempt, backoff }, 'falha ao processar mensagem; volta para a fila');
            await sqs
              .send(
                new ChangeMessageVisibilityCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: message.ReceiptHandle,
                  VisibilityTimeout: backoff,
                }),
              )
              .catch(() => undefined);
          }
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        log.error({ err, subscription: name }, 'erro no long polling do SQS');
        await sleep(2_000);
      }
    }
  }

  return {
    provider: 'aws',
    publisher: {
      async publish(topic, event) {
        const attributes = Object.entries(messageAttributes(event)).map(([key, value]) => [
          key,
          { DataType: 'String', StringValue: value },
        ]);
        await sns.send(
          new PublishCommand({
            TopicArn: `${options.topicArnPrefix}${topicPhysicalName(options.prefix, topic)}`,
            Message: JSON.stringify(event),
            MessageAttributes: Object.fromEntries(attributes),
          }),
        );
      },
    },
    subscriber: {
      async start(handler) {
        for (const spec of options.subscriptions) {
          const name = subscriptionPhysicalName(options.prefix, options.service, spec.topic);
          const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
          if (!QueueUrl) throw new Error(`fila ${name} não encontrada`);
          log.info({ queue: name, topic: spec.topic, eventTypes: spec.eventTypes }, 'consumindo fila SQS');
          loops.push(poll(QueueUrl, name, handler));
        }
      },
      async stop() {
        abort.abort();
        await Promise.allSettled(loops);
      },
    },
  };
}
