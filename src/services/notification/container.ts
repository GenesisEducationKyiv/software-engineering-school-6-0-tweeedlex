import type { NotificationServiceConfig } from '@/config/notification-env';
import type { ILogger } from '@/shared/logger';
import { METRIC_DEFINITIONS, PrometheusMetricsCollector } from '@/shared/metrics';
import { BullMQConnection, BullMQProducer, BullMQWorkerFactory } from '@/shared/queue';
import { IngressService } from './ingress.service';
import { MockEmailProvider } from './internal/mock-email.provider';
import { NOTIFICATION_QUEUE, type NotificationJob } from './internal/notification.queue';
import { NotificationService } from './internal/notification.service';
import { buildNotificationWorker } from './internal/notification.worker';
import { ResendEmailProvider } from './internal/resend.provider';

export interface NotificationGraph {
  bullmq: BullMQConnection;
  metrics: PrometheusMetricsCollector;
  producer: BullMQProducer<NotificationJob>;
  worker: ReturnType<typeof buildNotificationWorker>;
  ingress: IngressService;
}

export function buildNotificationGraph(
  config: NotificationServiceConfig,
  logger: ILogger,
): NotificationGraph {
  const bullmq = new BullMQConnection(config.redisUrl, logger.child({ component: 'bullmq' }));
  const metrics = new PrometheusMetricsCollector(METRIC_DEFINITIONS, {
    defaultMetricsPrefix: 'notif_',
  });
  const emailProvider =
    config.emailProvider === 'mock'
      ? new MockEmailProvider(
          config.emailMockUrl,
          config.emailFrom,
          logger.child({ component: 'mock-email' }),
        )
      : new ResendEmailProvider(
          config.resendApiKey,
          config.emailFrom,
          logger.child({ component: 'resend' }),
        );
  const service = new NotificationService(
    emailProvider,
    config.baseUrl,
    metrics,
    logger.child({ component: 'service' }),
  );
  const producer = new BullMQProducer<NotificationJob>(
    NOTIFICATION_QUEUE,
    bullmq.getConnection(),
    logger.child({ component: 'producer' }),
  );
  const workerFactory = new BullMQWorkerFactory(
    bullmq.getConnection(),
    logger.child({ component: 'worker-factory' }),
  );
  const worker = buildNotificationWorker(workerFactory, service);
  const ingress = new IngressService(producer, logger.child({ component: 'ingress' }));
  return { bullmq, metrics, producer, worker, ingress };
}
