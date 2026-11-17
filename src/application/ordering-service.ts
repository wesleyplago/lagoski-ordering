import type { FastifyBaseLogger } from 'fastify';
import type { CloudEvent } from '../chassis/cloudevent.js';
import type { Db, Tx } from '../chassis/db.js';
import { NotFoundError } from '../chassis/errors.js';
import { enqueue } from '../chassis/outbox.js';
import { Consumed, ConsumedTypes as T, orderCancelled, orderConfirmed, orderPlaced, TOPIC } from '../contracts/events.js';
import * as domain from '../domain/order.js';
import type { Order, Transition } from '../domain/order.js';
import * as repo from '../infrastructure/repositories.js';

export type CartView = {
  id: string;
  customerId: string;
  orderId: string | null;
  items: Array<domain.CartItem & { productName: string; size: string; color: string; unitPriceCents: number; available: boolean }>;
  subtotalCents: number;
};

async function viewCart(tx: Tx, cart: domain.Cart): Promise<CartView> {
  const snaps = await repo.snapshots(tx, cart.items.map((i) => i.sku));
  const items = cart.items.map((i) => {
    const s = snaps.get(i.sku);
    return {
      ...i,
      productName: s?.productName ?? i.sku,
      size: s?.size ?? '',
      color: s?.color ?? '',
      unitPriceCents: s?.priceCents ?? 0,
      available: s?.available ?? false,
    };
  });
  return {
    id: cart.id,
    customerId: cart.customerId,
    orderId: cart.orderId,
    items,
    subtotalCents: items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0),
  };
}

export function createOrderingService(db: Db, logger: FastifyBaseLogger) {
  const loadCart = async (tx: Tx, id: string, lock = false) => {
    const cart = await repo.findCart(tx, id, lock);
    if (!cart) throw new NotFoundError('carrinho');
    return cart;
  };

  /** Aplica a transição e, se for o caso, grava o evento no outbox na mesma transação. */
  async function apply(tx: Tx, orderId: string, cause: CloudEvent, decide: (order: Order) => Transition) {
    const order = await repo.findOrder(tx, orderId, true);
    if (!order) {
      logger.warn({ orderId, type: cause.type }, 'evento de pedido desconhecido ignorado');
      return;
    }
    const result = decide(order);
    if (result.kind === 'ignored') {
      logger.info({ orderId, type: cause.type, reason: result.reason }, 'transição ignorada');
      return;
    }
    await repo.updateOrder(tx, result.order);
    const o = result.order;
    if (result.emit === 'confirmed') {
      await enqueue(
        tx,
        TOPIC,
        orderConfirmed({ orderId: o.id, customerId: o.customerId, totalCents: o.totalCents, lines: o.lines.map(({ sku, quantity }) => ({ sku, quantity })) }, cause),
      );
    }
    if (result.emit === 'cancelled' && o.cancelReason) {
      await enqueue(tx, TOPIC, orderCancelled({ orderId: o.id, customerId: o.customerId, reason: o.cancelReason }, cause));
    }
  }

  return {
    createCart: (customerId: string) =>
      db.tx(async (tx) => {
        const cart = domain.newCart(customerId);
        await repo.saveCart(tx, cart);
        return viewCart(tx, cart);
      }),

    getCart: (id: string) => db.tx(async (tx) => viewCart(tx, await loadCart(tx, id))),

    addItem: (cartId: string, sku: string, quantity: number) =>
      db.tx(async (tx) => {
        const cart = await loadCart(tx, cartId, true);
        const snap = (await repo.snapshots(tx, [sku])).get(sku);
        const updated = domain.addItem(cart, snap, quantity);
        await repo.saveCart(tx, updated);
        return viewCart(tx, updated);
      }),

    removeItem: (cartId: string, sku: string) =>
      db.tx(async (tx) => {
        const updated = domain.removeItem(await loadCart(tx, cartId, true), sku);
        await repo.saveCart(tx, updated);
        return viewCart(tx, updated);
      }),

    /** Idempotente por carrinho: repetir o POST devolve o mesmo pedido. */
    placeOrder: (cartId: string) =>
      db.tx(async (tx) => {
        const cart = await loadCart(tx, cartId, true);
        if (cart.orderId) return { order: (await repo.findOrder(tx, cart.orderId))!, created: false };
        const order = domain.placeOrder(cart, await repo.snapshots(tx, cart.items.map((i) => i.sku)));
        await repo.insertOrder(tx, order);
        await repo.saveCart(tx, { ...cart, orderId: order.id });
        await enqueue(
          tx,
          TOPIC,
          orderPlaced({
            orderId: order.id,
            customerId: order.customerId,
            currency: order.currency,
            totalCents: order.totalCents,
            lines: order.lines.map(({ sku, productName, quantity, unitPriceCents }) => ({ sku, productName, quantity, unitPriceCents })),
          }),
        );
        return { order, created: true };
      }),

    async getOrder(id: string) {
      const order = await repo.findOrder(db, id);
      if (!order) throw new NotFoundError('pedido');
      return order;
    },

    ordersOf: (customerId: string) => repo.ordersOf(db, customerId),

    /** Reação aos fatos dos outros contextos (coreografia). */
    async handle(event: CloudEvent, tx: Tx): Promise<void> {
      switch (event.type) {
        case T.productPublished: {
          const d = Consumed.productPublished.parse(event.data);
          for (const v of d.variants) {
            await repo.upsertSnapshot(tx, { sku: v.sku, productId: d.productId, productName: d.name, size: v.size, color: v.color, priceCents: v.priceCents, available: true });
          }
          return;
        }
        case T.variantPriceChanged: {
          const d = Consumed.variantPriceChanged.parse(event.data);
          return repo.updateSnapshotPrice(tx, d.sku, d.newPriceCents);
        }
        case T.productDiscontinued:
          return repo.markUnavailable(tx, Consumed.productDiscontinued.parse(event.data).skus);
        case T.stockReserved:
          return apply(tx, Consumed.stockReserved.parse(event.data).orderId, event, (o) => domain.onStockReserved(o));
        case T.stockRejected:
          return apply(tx, Consumed.stockRejected.parse(event.data).orderId, event, (o) => domain.cancel(o, 'OUT_OF_STOCK'));
        case T.reservationExpired:
          return apply(tx, Consumed.reservationExpired.parse(event.data).orderId, event, (o) => domain.cancel(o, 'RESERVATION_EXPIRED'));
        case T.paymentRequested: {
          const d = Consumed.paymentRequested.parse(event.data);
          return apply(tx, d.orderId, event, (o) => domain.onPaymentRequested(o, { paymentId: d.paymentId, checkoutUrl: d.checkoutUrl }));
        }
        case T.paymentAuthorized:
          return apply(tx, Consumed.paymentAuthorized.parse(event.data).orderId, event, (o) => domain.onPaymentAuthorized(o));
        case T.paymentDeclined:
          return apply(tx, Consumed.paymentDeclined.parse(event.data).orderId, event, (o) => domain.cancel(o, 'PAYMENT_DECLINED'));
        case T.shipmentDispatched: {
          const d = Consumed.shipmentDispatched.parse(event.data);
          return apply(tx, d.orderId, event, (o) => domain.onShipmentDispatched(o, d.trackingCode));
        }
        case T.shipmentDelivered:
          return apply(tx, Consumed.shipmentDelivered.parse(event.data).orderId, event, (o) => domain.onShipmentDelivered(o));
        default:
          logger.warn({ type: event.type }, 'tipo de evento não esperado (filtro da assinatura desatualizado?)');
      }
    },
  };
}
