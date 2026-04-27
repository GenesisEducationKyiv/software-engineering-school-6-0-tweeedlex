import { PrismaClient } from '@prisma/client';
import { config } from '../../config/env';
import { logger } from '../../config/logger';

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: config.databaseUrl,
    },
  },
  log:
    config.nodeEnv === 'development'
      ? [{ emit: 'event', level: 'query' }, 'error', 'warn']
      : ['error'],
});

prisma.$on('query' as never, (e: unknown) => {
  const event = e as { query: string; duration: number };
  logger.debug({ query: event.query, duration: event.duration }, 'Database query');
});
