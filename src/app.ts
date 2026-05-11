import path from 'node:path';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import type { ILogger } from '@/shared/logger';
import type { IMetricsCollector } from '@/shared/metrics';
import { METRIC_NAMES } from '@/shared/metrics';
import { registerErrorHandler } from '@/shared/errors/error-handler';
import type { SubscriptionService } from '@/modules/subscriptions';
import type { IGrpcProxyService } from '@/modules/grpc';

export interface AppDependencies {
  subscriptionService: SubscriptionService;
  proxyService?: IGrpcProxyService;
  metrics: IMetricsCollector;
  apiKey: string;
  logger: ILogger;
  grpcPort?: number;
}

export async function buildApp(deps: AppDependencies) {
  const isDev = process.env.NODE_ENV === 'development';

  const fastify = Fastify({
    disableRequestLogging: true,
    logger: isDev
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,reqId,req,res,responseTime' } } }
      : true,
  });

  await fastify.register(fastifySwagger, {
    openapi: {
      info: { title: 'GitHub Release Notification API', description: 'API for subscribing to GitHub repository release notifications.', version: '1.0.0' },
      servers: [
        { url: 'http://localhost:3000/api', description: 'Local development' },
        { url: 'https://github-subscriptions.tweeedlex.xyz/api', description: 'Production' },
      ],
      tags: [{ name: 'subscription', description: 'Subscription management operations' }],
      components: { securitySchemes: { apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' } } },
      security: [{ apiKey: [] }],
    },
  });

  await fastify.register(fastifySwaggerUi, { routePrefix: '/docs' });
  await fastify.register(fastifyCors, { origin: true });

  const publicDir = path.join(__dirname, '..', 'src', 'public');
  await fastify.register(fastifyStatic, { root: publicDir, prefix: '/', wildcard: false });

  fastify.addHook('onRequest', (request, _reply, done) => {
    (request as any).startTime = Date.now();
    done();
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const duration = (Date.now() - (request as any).startTime) / 1000;
    const labels = { method: request.method, route: request.routerPath ?? request.url, status: String(reply.statusCode) };
    deps.metrics.incrementCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL, labels);
    deps.metrics.observeHistogram(METRIC_NAMES.HTTP_REQUEST_DURATION_SECONDS, duration, labels);
    deps.logger.info(`${request.method} ${reply.statusCode} ${request.url}`);
    done();
  });

  registerErrorHandler(fastify);

  const { subscriptionRoutes } = await import('@/modules/subscriptions/subscription.routes');
  const { metricsRoutes } = await import('@/modules/metrics/metrics.routes');

  await fastify.register(subscriptionRoutes, {
    prefix: '/api',
    subscriptionService: deps.subscriptionService,
    apiKey: deps.apiKey,
  });

  if (deps.proxyService) {
    const { grpcProxyRoutes } = await import('@/modules/grpc/grpc-proxy.routes');
    await fastify.register(grpcProxyRoutes, {
      prefix: '/api',
      proxyService: deps.proxyService,
      apiKey: deps.apiKey,
    });
  }

  await fastify.register(metricsRoutes, { prefix: '/api', metrics: deps.metrics });

  return fastify;
}
