import { ROOT_LOGGER } from '@/composition/tokens';
import type { Config } from '@/config/env';
import { createPrismaClient } from '@/infrastructure/db/prisma-factory';
import { type RedisClient, createRedisClient } from '@/infrastructure/redis/redis-factory';
import { type IEventBus, InProcessEventBus } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import { METRIC_DEFINITIONS, PrometheusMetricsCollector } from '@/shared/metrics';
import type { IMetricsCollector } from '@/shared/metrics';
import { BullMQConnection } from '@/shared/queue';
import type { PrismaClient } from '@prisma/client';
import { instanceCachingFactory } from 'tsyringe';
import type { DependencyContainer, InjectionToken } from 'tsyringe';

export const PRISMA: InjectionToken<PrismaClient> = Symbol('PRISMA');
export const REDIS: InjectionToken<RedisClient> = Symbol('REDIS');
export const BULLMQ: InjectionToken<BullMQConnection> = Symbol('BULLMQ');
export const METRICS: InjectionToken<IMetricsCollector> = Symbol('METRICS');
export const EVENT_BUS: InjectionToken<IEventBus> = Symbol('EVENT_BUS');

export function registerInfraModule(c: DependencyContainer): void {
  c.register(METRICS, {
    useFactory: instanceCachingFactory(
      () =>
        new PrometheusMetricsCollector(METRIC_DEFINITIONS, {
          defaultMetricsPrefix: 'github_notifier_',
        }),
    ),
  });
  c.register(EVENT_BUS, {
    useFactory: instanceCachingFactory((dep) => {
      const logger = dep.resolve<ILogger>(ROOT_LOGGER);
      return new InProcessEventBus(logger.child({ component: 'event-bus' }));
    }),
  });
}

// Async resources (prisma, redis, bullmq) need a live connection; created in
// the composition root and registered as instances there.
export async function createInfraInstances(config: Config, logger: ILogger) {
  const prisma = createPrismaClient(
    config.databaseUrl,
    config.nodeEnv,
    logger.child({ component: 'prisma' }),
  );
  const redis = await createRedisClient(config.redisUrl, logger.child({ component: 'redis' }));
  const bullmq = new BullMQConnection(config.redisUrl, logger.child({ component: 'bullmq' }));
  return { prisma, redis, bullmq };
}
