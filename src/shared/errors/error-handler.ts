import type { FastifyInstance } from 'fastify';
import { AppError, RateLimitError } from './app-error';

export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      if (error instanceof RateLimitError) {
        reply.header('Retry-After', error.retryAfter.toString());
      }
      return reply.status(error.statusCode).send({ message: error.message });
    }

    // Fastify validation errors
    if (error.validation) {
      return reply.status(400).send({ message: 'Invalid request parameters' });
    }

    fastify.log.error(error);
    return reply.status(500).send({ message: 'Internal server error' });
  });
}
