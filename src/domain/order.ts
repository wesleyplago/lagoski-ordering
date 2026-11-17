import { ulid } from 'ulid';
import { DomainError } from '../chassis/errors.js';
import type { CancelReason } from '../contracts/events.js';

/** O que o Ordering sabe de um SKU: projeção local dos eventos do Catalog. */
export type ProductSnapshot = {
  sku: string;
  productId: string;
  productName: string;
  size: string;
  color: string;
  priceCents: number;
  available: boolean;
};

export type CartItem = { sku: string; quantity: number };
export type Cart = { id: string; customerId: string; items: CartItem[]; orderId: string | null };

export type OrderStatus = 'PENDING' | 'AWAITING_PAYMENT' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export type OrderLine = { sku: string; productName: string; size: string; color: string; quantity: number; unitPriceCents: number };

export type Order = {
  id: string;
  customerId: string;
  currency: 'BRL';
  lines: OrderLine[];
  totalCents: number;
  status: OrderStatus;
  payment: { paymentId: string; checkoutUrl: string } | null;
  trackingCode: string | null;
  cancelReason: CancelReason | null;
  history: Array<{ status: OrderStatus; at: string; note?: string }>;
  version: number;
};

export const MAX_QTY_PER_LINE = 10;

/* -------------------------------- Cart -------------------------------- */

export function newCart(customerId: string): Cart {
  if (!/^cus_[a-z0-9_]{3,40}$/i.test(customerId)) throw new DomainError('INVALID_CUSTOMER', 'customerId deve ser cus_xxx');
  return { id: `cart_${ulid()}`, customerId, items: [], orderId: null };
}

export function addItem(cart: Cart, snapshot: ProductSnapshot | undefined, quantity: number): Cart {
  if (cart.orderId) throw new DomainError('CART_CLOSED', 'carrinho já virou pedido', 409);
  if (!snapshot || !snapshot.available) throw new DomainError('SKU_UNAVAILABLE', 'SKU não está à venda');
  if (!Number.isInteger(quantity) || quantity < 1) throw new DomainError('INVALID_QUANTITY', 'quantidade deve ser inteira e positiva');
  const current = cart.items.find((i) => i.sku === snapshot.sku)?.quantity ?? 0;
  if (current + quantity > MAX_QTY_PER_LINE) throw new DomainError('QUANTITY_LIMIT', `no máximo ${MAX_QTY_PER_LINE} por item`);
  const items = current
    ? cart.items.map((i) => (i.sku === snapshot.sku ? { ...i, quantity: i.quantity + quantity } : i))
    : [...cart.items, { sku: snapshot.sku, quantity }];
  return { ...cart, items };
}

export function removeItem(cart: Cart, sku: string): Cart {
  if (cart.orderId) throw new DomainError('CART_CLOSED', 'carrinho já virou pedido', 409);
  return { ...cart, items: cart.items.filter((i) => i.sku !== sku) };
}

/* -------------------------------- Order ------------------------------- */

/** Fecha o carrinho: congela nome e preço de cada item a partir da projeção. */
export function placeOrder(cart: Cart, snapshots: Map<string, ProductSnapshot>, now = new Date()): Order {
  if (cart.orderId) throw new DomainError('CART_CLOSED', 'carrinho já virou pedido', 409);
  if (cart.items.length === 0) throw new DomainError('EMPTY_CART', 'carrinho vazio');
  const lines = cart.items.map((item) => {
    const s = snapshots.get(item.sku);
    if (!s || !s.available) throw new DomainError('SKU_UNAVAILABLE', `${item.sku} saiu de venda`);
    return { sku: s.sku, productName: s.productName, size: s.size, color: s.color, quantity: item.quantity, unitPriceCents: s.priceCents };
  });
  return {
    id: `ord_${ulid()}`,
    customerId: cart.customerId,
    currency: 'BRL',
    lines,
    totalCents: lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0),
    status: 'PENDING',
    payment: null,
    trackingCode: null,
    cancelReason: null,
    history: [{ status: 'PENDING', at: now.toISOString() }],
    version: 0,
  };
}

/**
 * Resultado de aplicar um fato vindo de outro contexto. Eventos podem chegar
 * fora de ordem ou atrasados: uma transição que não faz sentido no estado atual
 * é ignorada (e registrada), nunca lança.
 */
export type Transition =
  | { kind: 'changed'; order: Order; emit?: 'confirmed' | 'cancelled' }
  | { kind: 'ignored'; reason: string };

const TERMINAL: OrderStatus[] = ['CANCELLED', 'DELIVERED'];

function move(order: Order, status: OrderStatus, now: Date, note?: string, patch: Partial<Order> = {}): Order {
  return { ...order, ...patch, status, history: [...order.history, { status, at: now.toISOString(), ...(note ? { note } : {}) }] };
}

const ignored = (order: Order, event: string): Transition => ({ kind: 'ignored', reason: `${event} com pedido ${order.status}` });

export function onStockReserved(order: Order, now = new Date()): Transition {
  if (order.status !== 'PENDING') return ignored(order, 'StockReserved');
  return { kind: 'changed', order: move(order, 'AWAITING_PAYMENT', now, 'estoque reservado') };
}

/** O link de pagamento pode chegar antes do StockReserved (filas diferentes). */
export function onPaymentRequested(order: Order, payment: { paymentId: string; checkoutUrl: string }, now = new Date()): Transition {
  if (order.status === 'PENDING') return { kind: 'changed', order: move(order, 'AWAITING_PAYMENT', now, 'checkout aberto', { payment }) };
  if (order.status === 'AWAITING_PAYMENT') return { kind: 'changed', order: { ...order, payment } };
  return ignored(order, 'PaymentRequested');
}

export function onPaymentAuthorized(order: Order, now = new Date()): Transition {
  // Pedido cancelado e pagamento autorizado depois: o Payment estorna sozinho.
  if (order.status !== 'PENDING' && order.status !== 'AWAITING_PAYMENT') return ignored(order, 'PaymentAuthorized');
  return { kind: 'changed', order: move(order, 'CONFIRMED', now, 'pagamento aprovado'), emit: 'confirmed' };
}

export function cancel(order: Order, reason: CancelReason, now = new Date()): Transition {
  if (order.status !== 'PENDING' && order.status !== 'AWAITING_PAYMENT') return ignored(order, `cancelamento ${reason}`);
  return { kind: 'changed', order: move(order, 'CANCELLED', now, reason, { cancelReason: reason }), emit: 'cancelled' };
}

export function onShipmentDispatched(order: Order, trackingCode: string, now = new Date()): Transition {
  if (order.status !== 'CONFIRMED') return ignored(order, 'ShipmentDispatched');
  return { kind: 'changed', order: move(order, 'SHIPPED', now, `rastreio ${trackingCode}`, { trackingCode }) };
}

export function onShipmentDelivered(order: Order, now = new Date()): Transition {
  if (TERMINAL.includes(order.status) || order.status === 'PENDING' || order.status === 'AWAITING_PAYMENT') {
    return ignored(order, 'ShipmentDelivered');
  }
  return { kind: 'changed', order: move(order, 'DELIVERED', now, 'entregue') };
}
