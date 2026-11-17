import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from './errors.js';

export function buildHttp(service: string): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', base: { service } },
    // Webhooks validam assinatura sobre o corpo cru.
    bodyLimit: 512 * 1024,
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
    if (error instanceof DomainError) {
      return reply.code(error.status).send({ error: error.code, message: error.message });
    }
    request.log.error({ err: error }, 'erro não tratado');
    const status = error.statusCode ?? 500;
    return reply.code(status).send({ error: status >= 500 ? 'INTERNAL' : 'BAD_REQUEST', message: error.message });
  });

  app.get('/healthz', async () => ({ status: 'ok', service }));
  return app;
}
