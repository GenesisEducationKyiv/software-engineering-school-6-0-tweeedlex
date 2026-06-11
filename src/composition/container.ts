import 'reflect-metadata';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import type { Config } from '@/config/env';
import {
  BULLMQ,
  EVENT_BUS,
  PRISMA,
  REDIS,
  createInfraInstances,
  registerInfraModule,
} from '@/infrastructure/infra.module';
import type { RedisClient } from '@/infrastructure/redis/redis-factory';
import { registerGithubModule } from '@/modules/github';
import {
  type INotificationClient,
  NOTIFICATION_CLIENT,
  NotificationHandlers,
  registerNotificationHandlers,
  registerNotificationsModule,
} from '@/modules/notifications';
import {
  type IScannerService,
  SCANNER_QUEUE,
  SCANNER_SERVICE,
  buildScannerScheduler,
  buildScannerWorker,
  registerScannerModule,
} from '@/modules/scanner';
import { registerSubscriptionsModule } from '@/modules/subscriptions';
import type { IEventBus } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import {
  type BullMQConnection,
  BullMQScheduler,
  BullMQWorkerFactory,
  type IWorker,
} from '@/shared/queue';
import type { PrismaClient } from '@prisma/client';
import { type DependencyContainer, container } from 'tsyringe';

export interface BuiltGraph {
  container: DependencyContainer;
  prisma: PrismaClient;
  redis: RedisClient;
  bullmq: BullMQConnection;
  scannerWorker: IWorker;
  scheduler: ReturnType<typeof buildScannerScheduler>;
  notificationClient: INotificationClient;
}

export async function buildContainer(config: Config, rootLogger: ILogger): Promise<BuiltGraph> {
  const c = container.createChildContainer();

  c.registerInstance(CONFIG, config);
  c.registerInstance(ROOT_LOGGER, rootLogger);

  const { prisma, redis, bullmq } = await createInfraInstances(config, rootLogger);
  c.registerInstance(PRISMA, prisma);
  c.registerInstance(REDIS, redis);
  c.registerInstance(BULLMQ, bullmq);

  registerInfraModule(c);
  registerGithubModule(c);
  registerSubscriptionsModule(c);
  registerScannerModule(c);
  registerNotificationsModule(c);

  const eventBus = c.resolve<IEventBus>(EVENT_BUS);
  const scannerService = c.resolve<IScannerService>(SCANNER_SERVICE);

  const workerFactory = new BullMQWorkerFactory(
    bullmq.getConnection(),
    rootLogger.child({ component: 'bullmq' }),
  );
  const scannerScheduler = new BullMQScheduler(
    SCANNER_QUEUE,
    bullmq.getConnection(),
    rootLogger.child({ component: 'bullmq', queue: 'scan-releases' }),
  );

  const notificationClient = c.resolve(NOTIFICATION_CLIENT);
  const notificationHandlers = new NotificationHandlers(
    notificationClient,
    rootLogger.child({ module: 'notifications', component: 'handlers' }),
  );
  registerNotificationHandlers(eventBus, notificationHandlers);

  const scannerWorker = buildScannerWorker(workerFactory, scannerService);
  const scheduler = buildScannerScheduler(scannerScheduler, config.scanIntervalMs);

  return {
    container: c,
    prisma,
    redis,
    bullmq,
    scannerWorker,
    scheduler,
    notificationClient,
  };
}
