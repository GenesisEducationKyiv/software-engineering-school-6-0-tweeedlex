import 'reflect-metadata';
import { loadNotificationConfig } from '@/config/notification-env';
import { PinoLogger } from '@/shared/logger';
import { buildNotificationGraph } from './container';
import { buildNotificationHttpServer } from './http/server';

async function main() {
  const config = loadNotificationConfig();
  const logger = PinoLogger.create({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    pretty: config.nodeEnv === 'development',
    base: { service: 'notification-service', env: config.nodeEnv },
  });

  logger.info('Starting notification service...');
  const graph = buildNotificationGraph(config, logger);

  const http = await buildNotificationHttpServer({ logger });
  await http.listen({ port: config.notificationHttpPort, host: '0.0.0.0' });
  logger.info({ port: config.notificationHttpPort }, 'Notification HTTP healthcheck listening');

  await graph.start();
  logger.info('Notification consumer started');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Notification service shutting down');
    await http.close();
    await graph.close();
    logger.info('Notification service shut down gracefully');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error during notification service startup:', err);
  process.exit(1);
});
