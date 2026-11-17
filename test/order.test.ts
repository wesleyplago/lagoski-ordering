import { describe, expect, it } from 'vitest';
import * as d from '../src/domain/order.js';

const snap = (sku: string, priceCents = 8990, available = true): d.ProductSnapshot => ({
  sku,
  productId: 'prd_x',
  productName: 'Ondas do Lago',
  size: 'M',
  color: 'Preto',
  priceCents,
  available,
});

function placed(): d.Order {
  let cart = d.newCart('cus_guest_1');
  cart = d.addItem(cart, snap('A'), 2);
  cart = d.addItem(cart, snap('B', 5990), 1);
  return d.placeOrder(cart, new Map([['A', snap('A')], ['B', snap('B', 5990)]]));
}

const changed = (t: d.Transition) => {
  if (t.kind !== 'changed') throw new Error(`esperava mudança: ${t.reason}`);
  return t;
};

describe('Cart', () => {
  it('soma quantidades do mesmo SKU e respeita o limite por item', () => {
    let cart = d.addItem(d.newCart('cus_a1b2'), snap('A'), 4);
    cart = d.addItem(cart, snap('A'), 6);
    expect(cart.items).toEqual([{ sku: 'A', quantity: 10 }]);
    expect(() => d.addItem(cart, snap('A'), 1)).toThrow('no máximo');
  });

  it('não aceita SKU fora de venda nem carrinho já fechado', () => {
    expect(() => d.addItem(d.newCart('cus_a1b2'), snap('A', 100, false), 1)).toThrow('não está à venda');
    expect(() => d.addItem({ ...d.newCart('cus_a1b2'), orderId: 'ord_1' }, snap('A'), 1)).toThrow('já virou pedido');
  });
});

describe('Order', () => {
  it('congela preço e calcula o total', () => {
    const order = placed();
    expect(order.totalCents).toBe(2 * 8990 + 5990);
    expect(order.status).toBe('PENDING');
  });

  it('caminho feliz: reservado → pagamento → confirmado → enviado → entregue', () => {
    let o = changed(d.onStockReserved(placed())).order;
    o = changed(d.onPaymentRequested(o, { paymentId: 'pay_1', checkoutUrl: 'https://checkout.stripe.com/x' })).order;
    const confirmed = changed(d.onPaymentAuthorized(o));
    expect(confirmed.emit).toBe('confirmed');
    o = changed(d.onShipmentDispatched(confirmed.order, 'LGK123')).order;
    o = changed(d.onShipmentDelivered(o)).order;
    expect(o.history.map((h) => h.status)).toEqual(['PENDING', 'AWAITING_PAYMENT', 'CONFIRMED', 'SHIPPED', 'DELIVERED']);
  });

  it('link de pagamento antes do StockReserved também avança (filas diferentes)', () => {
    const o = changed(d.onPaymentRequested(placed(), { paymentId: 'pay_1', checkoutUrl: 'u' })).order;
    expect(o.status).toBe('AWAITING_PAYMENT');
    expect(d.onStockReserved(o).kind).toBe('ignored');
  });

  it('sem estoque cancela e emite OrderCancelled', () => {
    const t = changed(d.cancel(placed(), 'OUT_OF_STOCK'));
    expect(t.order.cancelReason).toBe('OUT_OF_STOCK');
    expect(t.emit).toBe('cancelled');
  });

  it('pagamento aprovado depois do cancelamento é ignorado (o Payment estorna)', () => {
    const cancelled = changed(d.cancel(placed(), 'RESERVATION_EXPIRED')).order;
    expect(d.onPaymentAuthorized(cancelled)).toMatchObject({ kind: 'ignored' });
  });

  it('entrega antes do despacho (fora de ordem) é aceita; despacho atrasado é ignorado', () => {
    const confirmed = changed(d.onPaymentAuthorized(placed())).order;
    const delivered = changed(d.onShipmentDelivered(confirmed)).order;
    expect(delivered.status).toBe('DELIVERED');
    expect(d.onShipmentDispatched(delivered, 'LGK').kind).toBe('ignored');
  });
});
