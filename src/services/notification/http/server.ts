import type { ILogger } from '@/shared/logger';
import Fastify, { type FastifyInstance } from 'fastify';

export interface NotificationHttpDeps {
  logger: ILogger;
}

/** Liveness/readiness only — the notification service now consumes from the broker. */
export async function buildNotificationHttpServer(
  _deps: NotificationHttpDeps,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/healthz', async () => ({ status: 'ok' }));
  return app;
}
