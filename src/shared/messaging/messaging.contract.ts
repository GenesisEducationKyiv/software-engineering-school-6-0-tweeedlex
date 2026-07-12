import type { ReleaseEventPayload } from '@/shared/events';

/** Routing keys published to the notifications topic exchange. */
export const ROUTING_KEYS = {
  SUBSCRIPTION_CREATED: 'subscription.created',
  RELEASE_DETECTED: 'release.detected',
} as const;

export type RoutingKey = (typeof ROUTING_KEYS)[keyof typeof ROUTING_KEYS];

/** Wire schema version — bump on breaking payload changes. */
export const MESSAGE_SCHEMA_VERSION = 1 as const;

export interface SubscriptionCreatedMessage {
  v: typeof MESSAGE_SCHEMA_VERSION;
  email: string;
  repo: string;
  confirmToken: string;
}

export interface ReleaseSubscriber {
  email: string;
  unsubscribeToken: string;
}

export interface NewReleaseDetectedMessage {
  v: typeof MESSAGE_SCHEMA_VERSION;
  repo: string;
  release: ReleaseEventPayload;
  subscribers: ReleaseSubscriber[];
}

export type NotificationWireMessage = SubscriptionCreatedMessage | NewReleaseDetectedMessage;
