import path from 'node:path';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import type { SubscriptionService } from './modules/subscriptions/subscription.service';
import { registerErrorHandler } from './shared/errors/error-handler';

export interface AppDependencies {
  subscriptionService: SubscriptionService;
  apiKey: string;
  grpcPort?: number;
}

export async function buildApp(deps: AppDependencies) {
  const isDev = process.env.NODE_ENV === 'development';

  const fastify = Fastify({
    disableRequestLogging: true,
    logger: isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname,reqId,req,res,responseTime',
            },
          },
        }
      : true,
  });

  // Swagger
  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'GitHub Release Notification API',
        description: 'API for subscribing to GitHub repository release notifications.',
        version: '1.0.0',
      },
      servers: [
        { url: 'http://localhost:3000/api', description: 'Local development' },
        { url: 'https://github-subscriptions.tweeedlex.xyz/api', description: 'Production' },
      ],
      tags: [{ name: 'subscription', description: 'Subscription management operations' }],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
          },
        },
      },
      security: [{ apiKey: [] }],
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  // CORS
  await fastify.register(fastifyCors, {
    origin: true,
  });

  // Static files (HTML page)
  const publicDir = path.join(__dirname, '..', 'src', 'public');
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    wildcard: false,
  });

  // HTTP request logging
  fastify.addHook('onResponse', (request, reply, done) => {
    fastify.log.info(`${request.method} ${reply.statusCode} ${request.url}`);
    done();
  });

  // Error handler
  registerErrorHandler(fastify);

  // Routes
  const { subscriptionRoutes } = await import('./modules/subscriptions/subscription.routes');
  const { metricsRoutes } = await import('./modules/metrics/metrics.routes');

  await fastify.register(subscriptionRoutes, {
    prefix: '/api',
    subscriptionService: deps.subscriptionService,
    apiKey: deps.apiKey,
  });

  // gRPC proxy (browser → REST → gRPC)
  if (deps.grpcPort) {
    const { grpcProxyRoutes } = await import('./modules/grpc/grpc-proxy.routes');
    await fastify.register(grpcProxyRoutes, {
      prefix: '/api',
      grpcPort: deps.grpcPort,
      apiKey: deps.apiKey,
    });
  }

  await fastify.register(metricsRoutes, { prefix: '/api' });

  return fastify;
}
