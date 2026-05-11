import type { Config } from '@/config/env';
import { createPrismaClient } from '@/infrastructure/db/prisma-factory';
import { createRedisClient } from '@/infrastructure/redis/redis-factory';
import type { ILogger } from '@/shared/logger';
import { METRIC_DEFINITIONS } from '@/shared/metrics';
import { PrometheusMetricsCollector } from '@/shared/metrics';
import { InProcessEventBus } from '@/shared/events';
import { BullMQConnection, BullMQProducer, BullMQScheduler, BullMQWorkerFactory } from '@/shared/queue';
import { GitHubClient, GitHubCache, GitHubService } from '@/modules/github';
import { GrpcProxyService } from '@/modules/grpc';
import { ResendEmailProvider, NotificationService, NotificationHandlers, registerNotificationHandlers, buildNotificationWorker, NOTIFICATION_QUEUE } from '@/modules/notifications';
import type { NotificationJob } from '@/modules/notifications';
import { ScannerService, SCANNER_QUEUE, buildScannerWorker, buildScannerScheduler } from '@/modules/scanner';
import { SubscriptionRepository, RepoRepository, SubscriptionService, SubscriptionValidator } from '@/modules/subscriptions';

export interface AppGraph {
  prisma: ReturnType<typeof createPrismaClient>;
  redis: Awaited<ReturnType<typeof createRedisClient>>;
  bullmq: BullMQConnection;
  metrics: PrometheusMetricsCollector;
  subscriptionService: SubscriptionService;
  scannerService: ScannerService;
  grpcProxyService: GrpcProxyService;
  notificationWorker: ReturnType<typeof buildNotificationWorker>;
  scannerWorker: ReturnType<typeof buildScannerWorker>;
  scheduler: ReturnType<typeof buildScannerScheduler>;
  notificationProducer: BullMQProducer<NotificationJob>;
}

export async function buildGraph(config: Config, rootLogger: ILogger): Promise<AppGraph> {
  const prisma = createPrismaClient(config.databaseUrl, config.nodeEnv, rootLogger.child({ component: 'prisma' }));
  const redis = await createRedisClient(config.redisUrl, rootLogger.child({ component: 'redis' }));
  const bullmq = new BullMQConnection(config.redisUrl, rootLogger.child({ component: 'bullmq' }));

  const metrics = new PrometheusMetricsCollector(METRIC_DEFINITIONS, { defaultMetricsPrefix: 'github_notifier_' });
  const eventBus = new InProcessEventBus(rootLogger.child({ component: 'event-bus' }));

  const subscriptionRepo = new SubscriptionRepository(prisma);
  const repoRepo = new RepoRepository(prisma);

  const githubLogger = rootLogger.child({ module: 'github' });
  const githubClient = new GitHubClient(config.githubToken, githubLogger.child({ component: 'client' }), metrics);
  const githubCache = new GitHubCache(redis, config.githubCacheTtlSeconds, githubLogger.child({ component: 'cache' }));
  const githubService = new GitHubService(githubClient, githubCache);

  const emailProvider = new ResendEmailProvider(config.resendApiKey, config.emailFrom, rootLogger.child({ module: 'notifications', component: 'resend' }));
  const notificationService = new NotificationService(emailProvider, config.baseUrl, metrics, rootLogger.child({ module: 'notifications' }));

  const validator = new SubscriptionValidator();
  const subscriptionService = new SubscriptionService(subscriptionRepo, repoRepo, githubService, eventBus, validator, rootLogger.child({ module: 'subscriptions' }));
  const scannerService = new ScannerService(subscriptionRepo, repoRepo, githubService, eventBus, metrics, rootLogger.child({ module: 'scanner' }));

  const notificationProducer = new BullMQProducer<NotificationJob>(NOTIFICATION_QUEUE, bullmq.getConnection(), rootLogger.child({ component: 'bullmq', queue: 'notifications' }));
  const workerFactory = new BullMQWorkerFactory(bullmq.getConnection(), rootLogger.child({ component: 'bullmq' }));
  const scannerScheduler = new BullMQScheduler(SCANNER_QUEUE, bullmq.getConnection(), rootLogger.child({ component: 'bullmq', queue: 'scan-releases' }));

  const notificationHandlers = new NotificationHandlers(notificationProducer, rootLogger.child({ module: 'notifications', component: 'handlers' }));
  registerNotificationHandlers(eventBus, notificationHandlers);

  const notificationWorker = buildNotificationWorker(workerFactory, notificationService, rootLogger.child({ module: 'notifications', component: 'worker' }));
  const scannerWorker = buildScannerWorker(workerFactory, scannerService);
  const scheduler = buildScannerScheduler(scannerScheduler, config.scanIntervalMs);
  await scheduler.start();

  const grpcProxyService = new GrpcProxyService({ grpcPort: config.grpcPort, logger: rootLogger.child({ module: 'grpc', component: 'proxy' }) });

  return { prisma, redis, bullmq, metrics, subscriptionService, scannerService, grpcProxyService, notificationWorker, scannerWorker, scheduler, notificationProducer };
}
