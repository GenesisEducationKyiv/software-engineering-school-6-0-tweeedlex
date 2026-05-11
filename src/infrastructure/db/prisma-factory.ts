import { PrismaClient } from '@prisma/client';
import type { ILogger } from '@/shared/logger';

export function createPrismaClient(databaseUrl: string, nodeEnv: string, logger: ILogger): PrismaClient {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: nodeEnv === 'development' ? [{ emit: 'event', level: 'query' }, 'error', 'warn'] : ['error'],
  });

  prisma.$on('query' as never, (e: unknown) => {
    const event = e as { query: string; duration: number };
    logger.debug({ query: event.query, duration: event.duration }, 'Database query');
  });

  return prisma;
}
