import { execSync } from 'node:child_process';
import { buildApp } from './app';
import { buildGraph } from './composition/build-graph';
import { installShutdown } from './composition/shutdown';
import { config } from './config/env';
import { buildGrpcServer, startGrpcServer } from './modules/grpc';
import { PinoLogger } from './shared/logger';

async function main() {
  const rootLogger = PinoLogger.create({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    pretty: config.nodeEnv === 'development',
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

  const graph = await buildGraph(config, rootLogger);
  await graph.scheduler.start();

  const app = await buildApp({
    subscriptionService: graph.subscriptionService,
    proxyService: graph.grpcProxyService,
    metrics: graph.metrics,
    apiKey: config.apiKey,
    logger: rootLogger,
    grpcPort: config.grpcPort,
  });

  const grpcServer = buildGrpcServer({
    subscriptionService: graph.subscriptionService,
    apiKey: config.apiKey,
    logger: rootLogger.child({ module: 'grpc' }),
  });
  await startGrpcServer(grpcServer, config.grpcPort, rootLogger);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  rootLogger.info(`HTTP server listening on port ${config.port}`);

  installShutdown(app, grpcServer, graph, rootLogger);
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
