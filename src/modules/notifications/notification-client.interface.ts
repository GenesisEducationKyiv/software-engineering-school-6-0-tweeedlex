import type { ReleaseEventPayload } from '@/shared/events';

export interface INotificationClient {
  sendConfirmation(email: string, confirmToken: string, repo: string): Promise<void>;
  sendReleaseNotification(
    email: string,
    unsubscribeToken: string,
    repo: string,
    release: ReleaseEventPayload,
  ): Promise<void>;
  close?(): void | Promise<void>;
}
