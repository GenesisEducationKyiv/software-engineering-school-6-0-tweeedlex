import type { IEventBus } from '@/shared/events';
import { NEW_RELEASE_DETECTED, type NewReleaseDetectedEvent } from '@/shared/events';
import type { IMessagePublisher } from '@/shared/messaging';
import { MESSAGE_SCHEMA_VERSION, ROUTING_KEYS } from '@/shared/messaging';

export class BrokerEventPublisher {
  constructor(private readonly publisher: IMessagePublisher) {}

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
  bus.subscribe<NewReleaseDetectedEvent>(NEW_RELEASE_DETECTED, (e) => pub.onNewReleaseDetected(e));
}
