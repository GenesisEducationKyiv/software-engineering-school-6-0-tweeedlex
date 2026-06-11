import type { IEventBus } from '@/shared/events';
import { NEW_RELEASE_DETECTED, SUBSCRIPTION_CREATED } from '@/shared/events';
import type { NewReleaseDetectedEvent, SubscriptionCreatedEvent } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import type { INotificationClient } from './notification-client.interface';

export class NotificationHandlers {
  constructor(
    private readonly client: INotificationClient,
    private readonly logger: ILogger,
  ) {}

  async onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void> {
    await this.client.sendConfirmation(event.email, event.confirmToken, event.repoSlug);
    this.logger.info({ email: event.email }, 'Confirmation requested');
  }

  async onNewReleaseDetected(event: NewReleaseDetectedEvent): Promise<void> {
    for (const sub of event.subscribers) {
      await this.client.sendReleaseNotification(
        sub.email,
        sub.unsubscribeToken,
        event.repoSlug,
        event.release,
      );
    }
    this.logger.info(
      { repo: event.repoSlug, count: event.subscribers.length },
      'Release notifications requested',
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
