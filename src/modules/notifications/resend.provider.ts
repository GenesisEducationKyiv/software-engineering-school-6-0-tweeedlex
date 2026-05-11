import { Resend } from 'resend';
import type { ILogger } from '@/shared/logger';
import type { EmailProvider } from './email.provider';

export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly fromAddress: string,
    private readonly logger: ILogger,
  ) {
    this.client = new Resend(apiKey);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.fromAddress, to, subject, html });
    if (error) {
      this.logger.error({ error, to, subject }, 'Failed to send email via Resend');
      throw new Error(`Email send failed: ${error.message}`);
    }
    this.logger.info({ to, subject }, 'Email sent successfully');
  }
}
