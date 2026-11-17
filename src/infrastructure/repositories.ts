import type { Tx } from '../chassis/db.js';
import { DomainError } from '../chassis/errors.js';
import type { Cart, Order, ProductSnapshot } from '../domain/order.js';

/* ------------------------------ snapshots ------------------------------ */

export async function upsertSnapshot(tx: Tx, s: ProductSnapshot): Promise<void> {
  await tx.query(
    `insert into product_snapshots (sku, product_id, product_name, size, color, price_cents, available, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (sku) do update set product_id = $2, product_name = $3, size = $4, color = $5, price_cents = $6, available = $7, updated_at = now()`,
    [s.sku, s.productId, s.productName, s.size, s.color, s.priceCents, s.available],
  );
}

export async function updateSnapshotPrice(tx: Tx, sku: string, priceCents: number): Promise<void> {
  await tx.query('update product_snapshots set price_cents = $2, updated_at = now() where sku = $1', [sku, priceCents]);
}

export async function markUnavailable(tx: Tx, skus: string[]): Promise<void> {
  await tx.query('update product_snapshots set available = false, updated_at = now() where sku = any($1)', [skus]);
}

type SnapshotRow = { sku: string; product_id: string; product_name: string; size: string; color: string; price_cents: number; available: boolean };

export async function snapshots(tx: Tx, skus: string[]): Promise<Map<string, ProductSnapshot>> {
  const { rows } = await tx.query<SnapshotRow>('select * from product_snapshots where sku = any($1)', [skus]);
  return new Map(
    rows.map((r) => [
      r.sku,
      { sku: r.sku, productId: r.product_id, productName: r.product_name, size: r.size, color: r.color, priceCents: r.price_cents, available: r.available },
    ]),
  );
}

/* -------------------------------- carts -------------------------------- */

export async function findCart(tx: Tx, id: string, lock = false): Promise<Cart | null> {
  const { rows } = await tx.query<{ id: string; customer_id: string; order_id: string | null }>(
    `select id, customer_id, order_id from carts where id = $1${lock ? ' for update' : ''}`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const items = await tx.query<{ sku: string; quantity: number }>('select sku, quantity from cart_items where cart_id = $1 order by added_at', [id]);
  return { id: row.id, customerId: row.customer_id, orderId: row.order_id, items: items.rows };
}

export async function saveCart(tx: Tx, cart: Cart): Promise<void> {
  await tx.query(
    `insert into carts (id, customer_id, order_id) values ($1, $2, $3)
     on conflict (id) do update set order_id = $3`,
    [cart.id, cart.customerId, cart.orderId],
  );
  await tx.query('delete from cart_items where cart_id = $1 and not (sku = any($2))', [cart.id, cart.items.map((i) => i.sku)]);
  for (const item of cart.items) {
    await tx.query(
      `insert into cart_items (cart_id, sku, quantity) values ($1, $2, $3)
       on conflict (cart_id, sku) do update set quantity = $3`,
      [cart.id, item.sku, item.quantity],
    );
  }
}

/* -------------------------------- orders ------------------------------- */

type OrderRow = {
  id: string;
  customer_id: string;
  status: Order['status'];
  currency: 'BRL';
  total_cents: number;
  lines: Order['lines'];
  payment: Order['payment'];
  tracking_code: string | null;
  cancel_reason: Order['cancelReason'];
  history: Order['history'];
  version: number;
};

const toOrder = (r: OrderRow): Order => ({
  id: r.id,
  customerId: r.customer_id,
  status: r.status,
  currency: r.currency,
  totalCents: r.total_cents,
  lines: r.lines,
  payment: r.payment,
  trackingCode: r.tracking_code,
  cancelReason: r.cancel_reason,
  history: r.history,
  version: r.version,
});

export async function findOrder(tx: Tx, id: string, lock = false): Promise<Order | null> {
  const { rows } = await tx.query<OrderRow>(`select * from orders where id = $1${lock ? ' for update' : ''}`, [id]);
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function ordersOf(tx: Tx, customerId: string): Promise<Order[]> {
  const { rows } = await tx.query<OrderRow>('select * from orders where customer_id = $1 order by created_at desc limit 20', [customerId]);
  return rows.map(toOrder);
}

export async function insertOrder(tx: Tx, o: Order): Promise<void> {
  await tx.query(
    `insert into orders (id, customer_id, status, currency, total_cents, lines, payment, tracking_code, cancel_reason, history, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0)`,
    [o.id, o.customerId, o.status, o.currency, o.totalCents, JSON.stringify(o.lines), o.payment && JSON.stringify(o.payment), o.trackingCode, o.cancelReason, JSON.stringify(o.history)],
  );
}

/** Concorrência otimista: falha se alguém salvou o pedido depois da leitura. */
export async function updateOrder(tx: Tx, o: Order): Promise<void> {
  const result = await tx.query(
    `update orders set status = $3, payment = $4, tracking_code = $5, cancel_reason = $6, history = $7, version = version + 1, updated_at = now()
      where id = $1 and version = $2`,
    [o.id, o.version, o.status, o.payment && JSON.stringify(o.payment), o.trackingCode, o.cancelReason, JSON.stringify(o.history)],
  );
  if (result.rowCount !== 1) throw new DomainError('CONCURRENT_UPDATE', `pedido ${o.id} mudou durante a operação`, 409);
}
