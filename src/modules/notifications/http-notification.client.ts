import type { ReleaseEventPayload } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import type { INotificationClient } from './notification-client.interface';

type FetchLike = typeof fetch;

export class HttpNotificationClient implements INotificationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly logger: ILogger,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async post(path: string, body: unknown): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.logger.error({ path, status: res.status }, 'Notification service call failed');
      throw new Error(`Notification service responded ${res.status}`);
    }
  }

  sendConfirmation(email: string, confirmToken: string, repo: string): Promise<void> {
    return this.post('/notifications/confirmation', { email, confirmToken, repo });
  }

  sendReleaseNotification(
    email: string,
    unsubscribeToken: string,
    repo: string,
    release: ReleaseEventPayload,
  ): Promise<void> {
    return this.post('/notifications/release', { email, unsubscribeToken, repo, release });
  }

  close(): void {
    // HTTP client holds no persistent connection; nothing to close.
  }
}
