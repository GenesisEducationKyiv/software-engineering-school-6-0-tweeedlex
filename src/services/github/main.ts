import 'reflect-metadata';
import { loadGithubServiceConfig } from '@/config/github-env';
import { PinoLogger } from '@/shared/logger';
import { buildGithubGraph } from './container';
import { buildGithubHttpServer } from './http/server';
import { buildGithubGrpcServer, startGrpcServer } from './grpc/server';

async function main() {
  const config = loadGithubServiceConfig();
  const logger = PinoLogger.create({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    pretty: config.nodeEnv === 'development',
    base: { service: 'github-service', env: config.nodeEnv },
  });

  logger.info('Starting github-service...');

  const graph = await buildGithubGraph(config, logger);
  await graph.start();

  const http = await buildGithubHttpServer({ service: graph.service, apiKey: config.apiKey, logger });
  await http.listen({ port: config.githubHttpPort, host: '0.0.0.0' });
  logger.info({ port: config.githubHttpPort }, 'github-service HTTP listening');

  const grpc = buildGithubGrpcServer({ service: graph.service, apiKey: config.apiKey, logger });
  await startGrpcServer(grpc, config.githubGrpcPort, logger);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'github-service shutting down');
    await http.close();
    grpc.forceShutdown();
    await graph.close();
    logger.info('github-service shut down gracefully');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error during github-service startup:', err);
  process.exit(1);
});
