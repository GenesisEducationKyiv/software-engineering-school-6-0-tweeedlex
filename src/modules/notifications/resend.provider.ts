import { Resend } from 'resend';
import { logger } from '../../config/logger';
import type { EmailProvider } from './email.provider';

const FROM_EMAIL = 'GitHub Release Notifier <noreply@tweeedlex.xyz>';

export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      logger.error({ error, to, subject }, 'Failed to send email via Resend');
      throw new Error(`Email send failed: ${error.message}`);
    }

    logger.info({ to, subject }, 'Email sent successfully');
  }
}
