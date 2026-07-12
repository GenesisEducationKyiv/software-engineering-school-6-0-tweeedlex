import type { ILogger } from '@/shared/logger';
import type { EmailProvider } from './email.provider';

export class MockEmailProvider implements EmailProvider {
  constructor(
    private readonly mockUrl: string,
    private readonly fromAddress: string,
    private readonly logger: ILogger,
  ) {}

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const response = await fetch(`${this.mockUrl.replace(/\/$/, '')}/emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.fromAddress, to, subject, html }),
    });

    if (!response.ok) {
      this.logger.error({ status: response.status, to, subject }, 'Mock email service failed');
      throw new Error(`Mock email send failed: ${response.status}`);
    }

    this.logger.info({ to, subject }, 'Mock email captured');
  }
}
