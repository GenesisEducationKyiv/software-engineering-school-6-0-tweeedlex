import type { ReleaseEventPayload } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import type { IMetricsCollector } from '@/shared/metrics';
import { METRIC_NAMES } from '@/shared/metrics';
import type { EmailProvider } from './email.provider';
import { confirmationEmailTemplate } from './templates/confirmation';
import { type ReleaseEmailData, releaseEmailTemplate } from './templates/release';

export class NotificationService {
  constructor(
    private readonly emailProvider: EmailProvider,
    private readonly baseUrl: string,
    private readonly metrics: IMetricsCollector,
    private readonly logger: ILogger,
  ) {}

  async sendConfirmationEmail(email: string, confirmToken: string, repo: string): Promise<void> {
    const confirmUrl = `${this.baseUrl}/confirm.html?token=${confirmToken}`;
    const html = confirmationEmailTemplate(repo, confirmUrl);
    await this.emailProvider.sendEmail(email, `Confirm subscription to ${repo} releases`, html);
    this.metrics.incrementCounter(METRIC_NAMES.NOTIFICATIONS_SENT_TOTAL, { type: 'confirmation' });
    this.logger.info({ email, repo }, 'Confirmation email sent');
  }

  async sendReleaseNotification(
    email: string,
    unsubscribeToken: string,
    repo: string,
    release: ReleaseEventPayload,
  ): Promise<void> {
    const unsubscribeUrl = `${this.baseUrl}/unsubscribe.html?token=${unsubscribeToken}`;
    const data: ReleaseEmailData = {
      repo,
      tagName: release.tagName,
      releaseName: release.name,
      releaseUrl: release.htmlUrl,
      publishedAt: release.publishedAt,
      unsubscribeUrl,
    };
    const html = releaseEmailTemplate(data);
    await this.emailProvider.sendEmail(email, `New release: ${repo} ${release.tagName}`, html);
    this.metrics.incrementCounter(METRIC_NAMES.NOTIFICATIONS_SENT_TOTAL, {
      type: 'release-notification',
    });
    this.logger.info({ email, repo }, 'Release notification sent');
  }
}
