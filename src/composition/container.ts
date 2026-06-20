import 'reflect-metadata';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import type { Config } from '@/config/env';
import {
  BULLMQ,
  EVENT_BUS,
  PRISMA,
  RABBITMQ,
  REDIS,
  createInfraInstances,
  registerInfraModule,
} from '@/infrastructure/infra.module';
import type { RedisClient } from '@/infrastructure/redis/redis-factory';
import { registerGithubModule } from '@/modules/github';
import {
  CONFIRMATION_SAGA,
  type ConfirmationSaga,
  OUTBOX_REPO,
  SagaBroker,
  registerSagaModule,
} from '@/modules/saga';
import {
  type IScannerService,
  SCANNER_QUEUE,
  SCANNER_SERVICE,
  buildScannerScheduler,
  buildScannerWorker,
  registerScannerModule,
} from '@/modules/scanner';
import { SUBSCRIPTION_REPO, registerSubscriptionsModule } from '@/modules/subscriptions';
import type { ISubscriptionRepository } from '@/modules/subscriptions';
import type { IEventBus } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import { RETRY_DELAY_MS, RabbitMqConnection, RabbitMqPublisher } from '@/shared/messaging';
import { OutboxRelay, type OutboxRepository } from '@/shared/outbox';
import {
  type BullMQConnection,
  BullMQScheduler,
  BullMQWorkerFactory,
  type IWorker,
} from '@/shared/queue';
import type { PrismaClient } from '@prisma/client';
import { type DependencyContainer, container } from 'tsyringe';
import { BrokerEventPublisher, registerBrokerEventPublisher } from './broker-event-publisher';
import { startSagaReplyConsumer } from './saga-reply-consumer';

export interface BuiltGraph {
  container: DependencyContainer;
  prisma: PrismaClient;
  redis: RedisClient;
  bullmq: BullMQConnection;
  rabbitmq: RabbitMqConnection;
  scannerWorker: IWorker;
  scheduler: ReturnType<typeof buildScannerScheduler>;
  brokerPublisher: RabbitMqPublisher;
  sagaBroker: SagaBroker;
  outboxRelay: OutboxRelay;
  sagaSweeper: ReturnType<typeof setInterval>;
}

export async function buildContainer(config: Config, rootLogger: ILogger): Promise<BuiltGraph> {
  const c = container.createChildContainer();

  c.registerInstance(CONFIG, config);
  c.registerInstance(ROOT_LOGGER, rootLogger);

  const { prisma, redis, bullmq, rabbitmq } = await createInfraInstances(config, rootLogger);
  c.registerInstance(PRISMA, prisma);
  c.registerInstance(REDIS, redis);
  c.registerInstance(BULLMQ, bullmq);
  c.registerInstance(RABBITMQ, rabbitmq);

  registerInfraModule(c);
  registerGithubModule(c);
  registerSubscriptionsModule(c);
  registerSagaModule(c, async (subscriptionId: string) => {
    const subRepo = c.resolve<ISubscriptionRepository>(SUBSCRIPTION_REPO);
    await subRepo.deleteSubscription(subscriptionId);
  });
  registerScannerModule(c);

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

  const brokerPublisher = new RabbitMqPublisher(
    rabbitmq,
    { retryDelayMs: RETRY_DELAY_MS },
    rootLogger.child({ component: 'rabbitmq-publisher' }),
  );
  registerBrokerEventPublisher(eventBus, new BrokerEventPublisher(brokerPublisher));

  const scannerWorker = buildScannerWorker(workerFactory, scannerService);
  const scheduler = buildScannerScheduler(scannerScheduler, config.scanIntervalMs);

  const confirmationSaga = c.resolve<ConfirmationSaga>(CONFIRMATION_SAGA);
  const sagaConnection = new RabbitMqConnection(
    config.rabbitmqUrl,
    rootLogger.child({ component: 'saga-rabbitmq' }),
  );
  const sagaBroker = new SagaBroker(sagaConnection, rootLogger.child({ component: 'saga-broker' }));
  const outboxRepo = c.resolve<OutboxRepository>(OUTBOX_REPO);
  const outboxRelay = new OutboxRelay(
    outboxRepo,
    // `exchange` is intentionally ignored — SagaBroker.publishCommand always publishes
    // to SAGA_EXCHANGES.commands (the only exchange the saga outbox writes to).
    (_exchange, routingKey, payload) => sagaBroker.publishCommand(routingKey, payload),
    { batchSize: config.outboxBatchSize, maxAttempts: config.outboxMaxAttempts },
    rootLogger.child({ component: 'outbox-relay' }),
  );
  outboxRelay.start(config.outboxPollMs);
  await startSagaReplyConsumer(sagaBroker, confirmationSaga);
  const sagaSweeper = setInterval(() => {
    void confirmationSaga.sweepTimeouts(new Date());
  }, config.sagaSweepMs);

  return {
    container: c,
    prisma,
    redis,
    bullmq,
    rabbitmq,
    scannerWorker,
    scheduler,
    brokerPublisher,
    sagaBroker,
    outboxRelay,
    sagaSweeper,
  };
}
