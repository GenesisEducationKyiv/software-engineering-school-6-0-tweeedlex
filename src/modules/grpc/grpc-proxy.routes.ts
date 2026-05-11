import type { FastifyPluginAsync } from 'fastify';
import { createApiKeyGuard } from '@/modules/auth';
import type { IGrpcProxyService } from './grpc-proxy.service';

interface GrpcProxyOptions {
  proxyService: IGrpcProxyService;
  apiKey: string;
}

interface GrpcProxyBody {
  method: string;
  payload: Record<string, unknown>;
}

const grpcProxyPlugin: FastifyPluginAsync<GrpcProxyOptions> = async (fastify, options) => {
  const apiKeyGuard = createApiKeyGuard(options.apiKey);
  fastify.post<{ Body: GrpcProxyBody }>(
    '/grpc-proxy',
    { preHandler: [apiKeyGuard] },
    async (request, reply) => {
      const { method, payload } = request.body;
      const apiKey = request.headers['x-api-key'] as string;
      const { status, body } = await options.proxyService.call(method, payload, apiKey);
      return reply.status(status).send(body);
    },
  );
};

export const grpcProxyRoutes = grpcProxyPlugin;
