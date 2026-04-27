import type { GitHubRelease } from '../github/github.types';
import type { EmailProvider } from './email.provider';
import { confirmationEmailTemplate } from './templates/confirmation';
import { type ReleaseEmailData, releaseEmailTemplate } from './templates/release';

export class NotificationService {
  constructor(
    private readonly emailProvider: EmailProvider,
    private readonly baseUrl: string,
  ) {}

  async sendConfirmationEmail(email: string, confirmToken: string, repo: string): Promise<void> {
    const confirmUrl = `${this.baseUrl}/confirm.html?token=${confirmToken}`;
    const html = confirmationEmailTemplate(repo, confirmUrl);
    await this.emailProvider.sendEmail(email, `Confirm subscription to ${repo} releases`, html);
  }

  async sendReleaseNotification(
    email: string,
    unsubscribeToken: string,
    repo: string,
    release: GitHubRelease,
  ): Promise<void> {
    const unsubscribeUrl = `${this.baseUrl}/unsubscribe.html?token=${unsubscribeToken}`;
    const data: ReleaseEmailData = {
      repo,
      tagName: release.tag_name,
      releaseName: release.name,
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
      unsubscribeUrl,
    };
    const html = releaseEmailTemplate(data);
    await this.emailProvider.sendEmail(email, `New release: ${repo} ${release.tag_name}`, html);
  }
}
