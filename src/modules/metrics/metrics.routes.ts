import type { IMetricsCollector } from '@/shared/metrics';
import type { FastifyPluginAsync } from 'fastify';

const metricsRoutesPlugin: FastifyPluginAsync<{ metrics: IMetricsCollector }> = async (
  fastify,
  opts,
) => {
  fastify.get('/metrics', async (_request, reply) => {
    const { contentType, body } = await opts.metrics.render();
    return reply.status(200).header('Content-Type', contentType).send(body);
  });
};

export const metricsRoutes = metricsRoutesPlugin;
