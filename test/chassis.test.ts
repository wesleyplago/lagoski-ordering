import { describe, expect, it } from 'vitest';
import { messageAttributes, newEvent, parseEvent } from '../src/chassis/cloudevent.js';
import { createMemoryBus } from '../src/chassis/messaging/memory.js';
import { subscriptionPhysicalName, topicPhysicalName } from '../src/chassis/messaging/ports.js';

describe('chassis', () => {
  it('monta CloudEvent com correlação e causalidade', () => {
    const cause = newEvent({ source: 'lagoski/test', type: 'lagoski.test.cause.v1', data: {}, correlationId: 'ord_1' });
    const event = newEvent({
      source: 'lagoski/test',
      type: 'lagoski.test.effect.v1',
      data: { ok: true },
      correlationId: 'ord_1',
      causedBy: { id: cause.id, traceparent: '00-abc-def-01' },
    });
    expect(event.causationid).toBe(cause.id);
    expect(event.traceparent).toBe('00-abc-def-01');
    expect(parseEvent(JSON.stringify(event)).id).toBe(event.id);
    expect(messageAttributes(event)).toMatchObject({ ce_type: 'lagoski.test.effect.v1', correlation_id: 'ord_1' });
  });

  it('rejeita corpo que não é CloudEvent (vai para retry e depois DLQ)', () => {
    expect(() => parseEvent('{"hello":"world"}')).toThrow();
  });

  it('usa a mesma convenção de nomes do Terraform', () => {
    expect(topicPhysicalName('lagoski-dev', 'ordering.events')).toBe('lagoski-dev-ordering-events');
    expect(subscriptionPhysicalName('lagoski-dev', 'inventory', 'ordering.events')).toBe('lagoski-dev-inventory-on-ordering');
  });

  it('o barramento em memória aplica o filtro por tipo como o broker', async () => {
    const bus = createMemoryBus('svc', [{ topic: 'ordering.events', eventTypes: ['lagoski.ordering.order.placed.v1'] }]);
    const seen: string[] = [];
    await bus.subscriber.start(async ({ event }) => void seen.push(event.type));
    const placed = newEvent({ source: 's', type: 'lagoski.ordering.order.placed.v1', data: {}, correlationId: 'c' });
    const confirmed = newEvent({ source: 's', type: 'lagoski.ordering.order.confirmed.v1', data: {}, correlationId: 'c' });
    expect(await bus.inject('ordering.events', placed)).toBe(true);
    expect(await bus.inject('ordering.events', confirmed)).toBe(false);
    expect(seen).toEqual(['lagoski.ordering.order.placed.v1']);
  });
});
