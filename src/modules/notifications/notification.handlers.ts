import type { IEventBus } from '@/shared/events';
import { NEW_RELEASE_DETECTED, SUBSCRIPTION_CREATED } from '@/shared/events';
import type { NewReleaseDetectedEvent, SubscriptionCreatedEvent } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import type { IQueueProducer } from '@/shared/queue';
import type { NotificationJob } from './notification.queue';

export class NotificationHandlers {
  constructor(
    private readonly producer: IQueueProducer<NotificationJob>,
    private readonly logger: ILogger,
  ) {}

  async onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void> {
    await this.producer.enqueue(
      'send-confirmation',
      {
        type: 'confirmation',
        email: event.email,
        confirmToken: event.confirmToken,
        repo: event.repoSlug,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
    this.logger.info({ email: event.email }, 'Confirmation email enqueued');
  }

  async onNewReleaseDetected(event: NewReleaseDetectedEvent): Promise<void> {
    for (const sub of event.subscribers) {
      await this.producer.enqueue(
        'send-release-notification',
        {
          type: 'release-notification',
          email: sub.email,
          unsubscribeToken: sub.unsubscribeToken,
          repo: event.repoSlug,
          release: event.release,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    }
    this.logger.info(
      { repo: event.repoSlug, count: event.subscribers.length },
      'Release notifications enqueued',
    );
  }
}

export const registerNotificationHandlers = (
  bus: IEventBus,
  handlers: NotificationHandlers,
): void => {
  bus.subscribe<SubscriptionCreatedEvent>(SUBSCRIPTION_CREATED, (e) =>
    handlers.onSubscriptionCreated(e),
  );
  bus.subscribe<NewReleaseDetectedEvent>(NEW_RELEASE_DETECTED, (e) =>
    handlers.onNewReleaseDetected(e),
  );
};
