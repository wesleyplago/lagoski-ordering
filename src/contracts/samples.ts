import type { CloudEvent } from '../chassis/cloudevent.js';
import { orderCancelled, orderConfirmed, orderPlaced } from './events.js';

export function contractSamples(): CloudEvent[] {
  const orderId = 'ord_01JD3X7Q9Z8K2M4N6P8R0T2V4X';
  return [
    orderPlaced({
      orderId,
      customerId: 'cus_guest_8f2a',
      currency: 'BRL',
      totalCents: 17980,
      lines: [{ sku: 'TEE-ONDASDOLAG-PRETO-M', productName: 'Ondas do Lago', quantity: 2, unitPriceCents: 8990 }],
    }),
    orderConfirmed({ orderId, customerId: 'cus_guest_8f2a', totalCents: 17980, lines: [{ sku: 'TEE-ONDASDOLAG-PRETO-M', quantity: 2 }] }),
    orderCancelled({ orderId, customerId: 'cus_guest_8f2a', reason: 'OUT_OF_STOCK' }),
  ];
}
