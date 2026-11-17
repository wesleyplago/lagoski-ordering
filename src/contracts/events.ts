import { z } from 'zod';
import { newEvent, type CloudEvent } from '../chassis/cloudevent.js';

export const TOPIC = 'ordering.events';
const SOURCE = 'lagoski/ordering';

/* ----------------------------- publicados ------------------------------ */

export const EventTypes = {
  orderPlaced: 'lagoski.ordering.order.placed.v1',
  orderConfirmed: 'lagoski.ordering.order.confirmed.v1',
  orderCancelled: 'lagoski.ordering.order.cancelled.v1',
} as const;

export type CancelReason = 'OUT_OF_STOCK' | 'PAYMENT_DECLINED' | 'RESERVATION_EXPIRED';

export type OrderPlacedV1 = {
  orderId: string;
  customerId: string;
  currency: 'BRL';
  totalCents: number;
  lines: Array<{ sku: string; productName: string; quantity: number; unitPriceCents: number }>;
};
export type OrderConfirmedV1 = { orderId: string; customerId: string; totalCents: number; lines: Array<{ sku: string; quantity: number }> };
export type OrderCancelledV1 = { orderId: string; customerId: string; reason: CancelReason };

type Cause = Pick<CloudEvent, 'id' | 'traceparent'> | undefined;
const make = <T extends { orderId: string }>(type: string, data: T, causedBy?: Cause) =>
  newEvent({ source: SOURCE, type, subject: `order/${data.orderId}`, correlationId: data.orderId, causedBy, data });

export const orderPlaced = (data: OrderPlacedV1) => make(EventTypes.orderPlaced, data);
export const orderConfirmed = (data: OrderConfirmedV1, causedBy?: Cause) => make(EventTypes.orderConfirmed, data, causedBy);
export const orderCancelled = (data: OrderCancelledV1, causedBy?: Cause) => make(EventTypes.orderCancelled, data, causedBy);

/* ------------------------------ consumidos ----------------------------- */
// Tolerant reader: só os campos que o Ordering usa. Campos novos no produtor não quebram nada.

export const Consumed = {
  productPublished: z.object({
    productId: z.string(),
    name: z.string(),
    variants: z.array(z.object({ sku: z.string(), size: z.string(), color: z.string(), priceCents: z.number().int() })),
  }),
  variantPriceChanged: z.object({ sku: z.string(), newPriceCents: z.number().int() }),
  productDiscontinued: z.object({ skus: z.array(z.string()) }),
  stockReserved: z.object({ orderId: z.string(), expiresAt: z.string() }),
  stockRejected: z.object({ orderId: z.string() }),
  reservationExpired: z.object({ orderId: z.string() }),
  paymentRequested: z.object({ orderId: z.string(), paymentId: z.string(), checkoutUrl: z.string() }),
  paymentAuthorized: z.object({ orderId: z.string(), paymentId: z.string() }),
  paymentDeclined: z.object({ orderId: z.string(), reason: z.string() }),
  shipmentDispatched: z.object({ orderId: z.string(), trackingCode: z.string() }),
  shipmentDelivered: z.object({ orderId: z.string() }),
};

export const ConsumedTypes = {
  productPublished: 'lagoski.catalog.product.published.v1',
  variantPriceChanged: 'lagoski.catalog.variant.price-changed.v1',
  productDiscontinued: 'lagoski.catalog.product.discontinued.v1',
  stockReserved: 'lagoski.inventory.stock.reserved.v1',
  stockRejected: 'lagoski.inventory.stock.reservation-rejected.v1',
  reservationExpired: 'lagoski.inventory.reservation.expired.v1',
  paymentRequested: 'lagoski.payment.payment.requested.v1',
  paymentAuthorized: 'lagoski.payment.payment.authorized.v1',
  paymentDeclined: 'lagoski.payment.payment.declined.v1',
  shipmentDispatched: 'lagoski.fulfillment.shipment.dispatched.v1',
  shipmentDelivered: 'lagoski.fulfillment.shipment.delivered.v1',
} as const;
