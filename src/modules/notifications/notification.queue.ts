import type { ReleaseEventPayload } from '@/shared/events';

export const NOTIFICATION_QUEUE = 'notifications';

export interface ConfirmationJob {
  type: 'confirmation';
  email: string;
  confirmToken: string;
  repo: string;
}

export interface ReleaseNotificationJob {
  type: 'release-notification';
  email: string;
  unsubscribeToken: string;
  repo: string;
  release: ReleaseEventPayload;
}

export type NotificationJob = ConfirmationJob | ReleaseNotificationJob;
