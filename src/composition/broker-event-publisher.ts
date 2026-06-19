import type { IEventBus } from '@/shared/events';
import {
  NEW_RELEASE_DETECTED,
  type NewReleaseDetectedEvent,
  SUBSCRIPTION_CREATED,
  type SubscriptionCreatedEvent,
} from '@/shared/events';
import type { IMessagePublisher } from '@/shared/messaging';
import { MESSAGE_SCHEMA_VERSION, ROUTING_KEYS } from '@/shared/messaging';

/**
 * Bridges the in-process event bus to the broker. Subscribed to the same two
 * domain events the old NotificationHandlers consumed; instead of an RPC call
 * it maps each event to a versioned wire message and publishes to RabbitMQ.
 */
export class BrokerEventPublisher {
  constructor(private readonly publisher: IMessagePublisher) {}

  async onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void> {
    await this.publisher.publish(ROUTING_KEYS.SUBSCRIPTION_CREATED, {
      v: MESSAGE_SCHEMA_VERSION,
      email: event.email,
      repo: event.repoSlug,
      confirmToken: event.confirmToken,
    });
  }

  async onNewReleaseDetected(event: NewReleaseDetectedEvent): Promise<void> {
    await this.publisher.publish(ROUTING_KEYS.RELEASE_DETECTED, {
      v: MESSAGE_SCHEMA_VERSION,
      repo: event.repoSlug,
      release: event.release,
      subscribers: event.subscribers,
    });
  }
}

export function registerBrokerEventPublisher(bus: IEventBus, pub: BrokerEventPublisher): void {
  bus.subscribe<SubscriptionCreatedEvent>(SUBSCRIPTION_CREATED, (e) =>
    pub.onSubscriptionCreated(e),
  );
  bus.subscribe<NewReleaseDetectedEvent>(NEW_RELEASE_DETECTED, (e) => pub.onNewReleaseDetected(e));
}
