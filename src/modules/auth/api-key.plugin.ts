import type { FastifyReply, FastifyRequest } from 'fastify';

export function createApiKeyGuard(apiKey: string) {
  return async function apiKeyGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const providedKey = request.headers['x-api-key'];
    if (!providedKey || providedKey !== apiKey) {
      reply.status(401).send({ message: 'Unauthorized: Invalid or missing API key' });
    }
  };
}
