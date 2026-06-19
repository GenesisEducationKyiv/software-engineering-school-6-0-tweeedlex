import type { NotificationServiceConfig } from '@/config/notification-env';
import type { ILogger } from '@/shared/logger';
import { RabbitMqConnection, RabbitMqConsumer } from '@/shared/messaging';
import { METRIC_DEFINITIONS, PrometheusMetricsCollector } from '@/shared/metrics';
import { buildNotificationConsumerHandler } from './consumer';
import { MockEmailProvider } from './internal/mock-email.provider';
import { NotificationService } from './internal/notification.service';
import { ResendEmailProvider } from './internal/resend.provider';

export interface NotificationGraph {
  metrics: PrometheusMetricsCollector;
  consumer: RabbitMqConsumer;
  start: () => Promise<void>;
  close: () => Promise<void>;
}

export function buildNotificationGraph(
  config: NotificationServiceConfig,
  logger: ILogger,
): NotificationGraph {
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
  const connection = new RabbitMqConnection(
    config.rabbitmqUrl,
    logger.child({ component: 'rabbitmq' }),
  );
  const consumer = new RabbitMqConsumer(
    connection,
    { retryDelayMs: config.retryDelayMs, maxAttempts: config.maxAttempts },
    logger.child({ component: 'consumer' }),
  );
  const handler = buildNotificationConsumerHandler(service);

  return {
    metrics,
    consumer,
    start: () => consumer.start(handler),
    close: () => consumer.close(),
  };
}
