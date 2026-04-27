import type { FastifyInstance } from 'fastify';
import { metricsRegistry } from './metrics.plugin';

async function metricsRoutesPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.get('/metrics', async (_request, reply) => {
    const metrics = await metricsRegistry.metrics();
    reply.status(200).header('Content-Type', metricsRegistry.contentType).send(metrics);
  });
}

export const metricsRoutes = metricsRoutesPlugin;
