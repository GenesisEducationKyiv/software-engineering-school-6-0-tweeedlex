import type { IGrpcProxyService } from '@/modules/grpc';
import type { ILogger } from '@/shared/logger';
import type { Server as GrpcServer } from '@grpc/grpc-js';
import type { FastifyInstance } from 'fastify';
import type { BuiltGraph } from './container';

export function installShutdown(
  app: FastifyInstance,
  grpcServer: GrpcServer,
  graph: BuiltGraph,
  grpcProxyService: IGrpcProxyService,
  logger: ILogger,
): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Received shutdown signal');
    await app.close();
    grpcServer.forceShutdown();
    grpcProxyService.close();
    await graph.scannerWorker.close();
    await graph.scheduler.stop();
    graph.outboxRelay.stop();
    clearInterval(graph.sagaSweeper);
    await graph.sagaBroker.close();
    await graph.brokerPublisher.close();
    await graph.bullmq.close();
    await graph.redis.quit();
    await graph.prisma.$disconnect();
    logger.info('Application shut down gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
