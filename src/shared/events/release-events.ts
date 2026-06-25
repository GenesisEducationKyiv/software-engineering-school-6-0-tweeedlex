import type { DomainEvent } from './event-bus.interface';
export const NEW_RELEASE_DETECTED = 'scanner.new-release-detected' as const;
export interface ReleaseEventPayload {
  tagName: string;
  name: string | null;
  htmlUrl: string;
  publishedAt: string | null;
}
export interface NewReleaseDetectedEvent extends DomainEvent {
  type: typeof NEW_RELEASE_DETECTED;
  repoSlug: string;
  release: ReleaseEventPayload;
  subscribers: Array<{ email: string; unsubscribeToken: string }>;
  occurredAt: string;
}
