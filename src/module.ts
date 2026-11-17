import { z } from 'zod';
import type { ServiceModule } from './chassis/bootstrap.js';
import { createOrderingService } from './application/ordering-service.js';
import { migrations } from './infrastructure/migrations.js';
import { subscriptions } from './messaging-config.js';

type IdParams = { Params: { id: string } };

export const orderingModule: ServiceModule = {
  name: 'ordering',
  defaultPort: 8082,
  migrations,
  subscriptions,
  register({ app, db, logger }) {
    const ordering = createOrderingService(db, logger);

    app.post('/carts', async (req, reply) => {
      const { customerId } = z.object({ customerId: z.string() }).parse(req.body);
      return reply.code(201).send(await ordering.createCart(customerId));
    });
    app.get<IdParams>('/carts/:id', async (req) => ordering.getCart(req.params.id));
    app.post<IdParams>('/carts/:id/items', async (req) => {
      const { sku, quantity } = z.object({ sku: z.string().min(3), quantity: z.number().int() }).parse(req.body);
      return ordering.addItem(req.params.id, sku, quantity);
    });
    app.delete<{ Params: { id: string; sku: string } }>('/carts/:id/items/:sku', async (req) => ordering.removeItem(req.params.id, req.params.sku));

    app.post('/orders', async (req, reply) => {
      const { cartId } = z.object({ cartId: z.string() }).parse(req.body);
      const { order, created } = await ordering.placeOrder(cartId);
      return reply.code(created ? 201 : 200).send(order);
    });
    app.get<IdParams>('/orders/:id', async (req) => ordering.getOrder(req.params.id));
    app.get<IdParams>('/customers/:id/orders', async (req) => ({ orders: await ordering.ordersOf(req.params.id) }));

    return { handle: ordering.handle };
  },
};
