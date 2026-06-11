import type { ILogger } from '@/shared/logger';
import Fastify, { type FastifyInstance } from 'fastify';
import type { IngressService } from '../ingress.service';
import { confirmationSchema, releaseSchema } from './schema';

export interface NotificationHttpDeps {
  ingress: IngressService;
  apiKey: string;
  logger: ILogger;
}

export async function buildNotificationHttpServer(
  deps: NotificationHttpDeps,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', (req, reply, done) => {
    const key = req.headers['x-api-key'];
    if (key !== deps.apiKey) {
      reply.code(401).send({ message: 'Unauthorized' });
      return;
    }
    done();
  });

  app.post('/notifications/confirmation', { schema: confirmationSchema }, async (req, reply) => {
    const ack = await deps.ingress.enqueueConfirmation(req.body as never);
    reply.code(202).send(ack);
  });

  app.post('/notifications/release', { schema: releaseSchema }, async (req, reply) => {
    const ack = await deps.ingress.enqueueRelease(req.body as never);
    reply.code(202).send(ack);
  });

  return app;
}
