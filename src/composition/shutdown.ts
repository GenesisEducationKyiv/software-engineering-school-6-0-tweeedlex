import type { FastifyInstance } from 'fastify';
import type { Server as GrpcServer } from '@grpc/grpc-js';
import type { ILogger } from '@/shared/logger';
import type { AppGraph } from './build-graph';

export function installShutdown(app: FastifyInstance, grpcServer: GrpcServer, graph: AppGraph, logger: ILogger): void {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    await app.close();
    grpcServer.forceShutdown();
    graph.grpcProxyService.close();
    await graph.notificationWorker.close();
    await graph.scannerWorker.close();
    await graph.scheduler.stop();
    await graph.notificationProducer.close();
    await graph.bullmq.close();
    await graph.redis.quit();
    await graph.prisma.$disconnect();
    logger.info('Application shut down gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
