import type { DomainEvent } from './event-bus.interface';
export const SUBSCRIPTION_CREATED = 'subscription.created' as const;
export interface SubscriptionCreatedEvent extends DomainEvent {
  type: typeof SUBSCRIPTION_CREATED;
  email: string;
  repoSlug: string;
  confirmToken: string;
  occurredAt: string;
}
