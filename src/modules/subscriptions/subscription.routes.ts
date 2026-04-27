import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createApiKeyGuard } from '../auth/api-key.plugin';
import {
  confirmSchema,
  subscribeSchema,
  subscriptionsSchema,
  unsubscribeSchema,
} from './subscription.schema';
import type { SubscriptionService } from './subscription.service';

interface SubscriptionRoutesOptions {
  subscriptionService: SubscriptionService;
  apiKey: string;
}

interface SubscribeBody {
  email: string;
  repo: string;
}

interface TokenParams {
  token: string;
}

interface SubscriptionsQuery {
  email: string;
}

const subscriptionRoutesPlugin: FastifyPluginAsync<SubscriptionRoutesOptions> = async (
  fastify: FastifyInstance,
  options: SubscriptionRoutesOptions,
): Promise<void> => {
  const service = options.subscriptionService;
  const apiKeyGuard = createApiKeyGuard(options.apiKey);

  fastify.post<{ Body: SubscribeBody }>(
    '/subscribe',
    {
      schema: subscribeSchema,
      preHandler: [apiKeyGuard],
    },
    async (request, reply) => {
      const { email, repo } = request.body;
      await service.subscribe(email, repo);
      return reply.status(200).send();
    },
  );

  fastify.get<{ Params: TokenParams }>(
    '/confirm/:token',
    { schema: confirmSchema },
    async (request, reply) => {
      const { token } = request.params;
      await service.confirm(token);
      return reply.status(200).send();
    },
  );

  fastify.get<{ Params: TokenParams }>(
    '/unsubscribe/:token',
    { schema: unsubscribeSchema },
    async (request, reply) => {
      const { token } = request.params;
      await service.unsubscribe(token);
      return reply.status(200).send();
    },
  );

  fastify.get<{ Querystring: SubscriptionsQuery }>(
    '/subscriptions',
    {
      schema: subscriptionsSchema,
      preHandler: [apiKeyGuard],
    },
    async (request, reply) => {
      const { email } = request.query;
      const subscriptions = await service.getSubscriptions(email);
      return reply.status(200).send(subscriptions);
    },
  );
};

export const subscriptionRoutes = subscriptionRoutesPlugin;
