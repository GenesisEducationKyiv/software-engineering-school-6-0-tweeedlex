import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { buildApp } from './app';
import { buildContainer } from './composition/container';
import { installShutdown } from './composition/shutdown';
import { config } from './config/env';
import { METRICS } from './infrastructure/infra.module';
import { GrpcProxyService, buildGrpcServer, startGrpcServer } from './modules/grpc';
import { SUBSCRIPTION_SERVICE } from './modules/subscriptions';
import { PinoLogger } from './shared/logger';

async function main() {
  const rootLogger = PinoLogger.create({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    pretty: config.nodeEnv === 'development',
    base: { service: config.serviceName, env: config.nodeEnv },
  });

  rootLogger.info('Starting application...');

  try {
    rootLogger.info('Running database migrations...');
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: config.databaseUrl },
      stdio: 'inherit',
    });
    rootLogger.info('Database migrations completed');
  } catch (err) {
    rootLogger.error({ err }, 'Database migration failed');
    process.exit(1);
  }

  const graph = await buildContainer(config, rootLogger);
  const subscriptionService = graph.container.resolve(SUBSCRIPTION_SERVICE);
  const metrics = graph.container.resolve(METRICS);

  const grpcProxyService = new GrpcProxyService({
    grpcPort: config.grpcPort,
    logger: rootLogger.child({ module: 'grpc', component: 'proxy' }),
  });

  await graph.scheduler.start();

  const app = await buildApp({
    subscriptionService,
    proxyService: grpcProxyService,
    metrics,
    apiKey: config.apiKey,
    logger: rootLogger,
    grpcPort: config.grpcPort,
  });

  const grpcServer = buildGrpcServer({
    subscriptionService,
    apiKey: config.apiKey,
    logger: rootLogger.child({ module: 'grpc' }),
  });
  await startGrpcServer(grpcServer, config.grpcPort, rootLogger);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  rootLogger.info(`HTTP server listening on port ${config.port}`);

  installShutdown(app, grpcServer, graph, grpcProxyService, rootLogger);
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
