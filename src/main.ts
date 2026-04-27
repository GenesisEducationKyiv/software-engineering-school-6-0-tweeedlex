import { execSync } from 'node:child_process';
import { buildApp } from './app';
import { config } from './config/env';
import { logger } from './config/logger';
import { prisma } from './infrastructure/db/prisma-client';
import { closeBullMQConnection, getBullMQConnection } from './infrastructure/queue/connection';
import { closeRedisClient, getRedisClient } from './infrastructure/redis/redis-client';
import { GitHubCache } from './modules/github/github.cache';
import { GitHubClient } from './modules/github/github.client';
import { GitHubService } from './modules/github/github.service';
import { buildGrpcServer, startGrpcServer } from './modules/grpc/grpc.server';
import { NotificationService } from './modules/notifications/notification.service';
import { NotificationWorker } from './modules/notifications/notification.worker';
import { ResendEmailProvider } from './modules/notifications/resend.provider';
import { ScannerScheduler } from './modules/scanner/scanner.scheduler';
import { ScannerService } from './modules/scanner/scanner.service';
import { ScannerWorker } from './modules/scanner/scanner.worker';
import { SubscriptionRepository } from './modules/subscriptions/subscription.repository';
import { SubscriptionService } from './modules/subscriptions/subscription.service';

async function main() {
  logger.info('Starting application...');

  // Run database migrations
  try {
    logger.info('Running database migrations...');
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: config.databaseUrl },
      stdio: 'inherit',
    });
    logger.info('Database migrations completed');
  } catch (err) {
    logger.error({ err }, 'Database migration failed');
    process.exit(1);
  }

  // Connect to Redis
  const redisClient = await getRedisClient();
  logger.info('Redis connected');

  // Initialize BullMQ connection
  const bullMQConnection = getBullMQConnection();

  // Build dependency graph
  const githubClient = new GitHubClient(config.githubToken);
  const githubCache = new GitHubCache(redisClient, config.githubCacheTtlSeconds);
  const githubService = new GitHubService(githubClient, githubCache);

  const subscriptionRepo = new SubscriptionRepository(prisma);
  const emailProvider = new ResendEmailProvider(config.resendApiKey);
  const notificationService = new NotificationService(emailProvider, config.baseUrl);

  const subscriptionService = new SubscriptionService(
    subscriptionRepo,
    githubService,
    bullMQConnection,
  );

  const scannerService = new ScannerService(subscriptionRepo, githubService, bullMQConnection);

  // Build Fastify app
  const app = await buildApp({
    subscriptionService,
    apiKey: config.apiKey,
    grpcPort: config.grpcPort,
  });

  // Start BullMQ workers
  const notificationWorker = new NotificationWorker(bullMQConnection, notificationService);
  const scannerWorker = new ScannerWorker(bullMQConnection, scannerService);

  // Start scanner scheduler
  const scheduler = new ScannerScheduler(bullMQConnection, config.scanIntervalMs);
  await scheduler.start();

  // Start gRPC server
  const grpcServer = buildGrpcServer({
    subscriptionService,
    apiKey: config.apiKey,
  });
  await startGrpcServer(grpcServer, config.grpcPort);

  // Start HTTP server
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`HTTP server listening on port ${config.port}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');

    await app.close();
    grpcServer.forceShutdown();
    await notificationWorker.close();
    await scannerWorker.close();
    await scheduler.stop();
    await closeBullMQConnection();
    await closeRedisClient();
    await prisma.$disconnect();

    logger.info('Application shut down gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
