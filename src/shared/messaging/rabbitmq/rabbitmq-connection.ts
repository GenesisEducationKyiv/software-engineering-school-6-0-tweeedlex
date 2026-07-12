import type { ILogger } from '@/shared/logger';
import amqp, { type ChannelModel, type Channel } from 'amqplib';

/**
 * Owns a single amqplib connection + channel. Lazily connects on first
 * getChannel(); reconnects on connection close (unless we asked it to close).
 */
export class RabbitMqConnection {
  private model: ChannelModel | null = null;
  private channel: Channel | null = null;
  private closing = false;

  constructor(
    private readonly url: string,
    private readonly logger: ILogger,
  ) {}

  async getChannel(): Promise<Channel> {
    if (this.channel) return this.channel;
    this.model = await amqp.connect(this.url);
    this.model.on('error', (err) => this.logger.error({ err }, 'RabbitMQ connection error'));
    this.model.on('close', () => {
      this.channel = null;
      this.model = null;
      if (!this.closing) {
        this.logger.warn('RabbitMQ connection closed unexpectedly');
      }
    });
    this.channel = await this.model.createChannel();
    this.logger.info('RabbitMQ connected');
    return this.channel;
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      await this.channel?.close();
      await this.model?.close();
    } finally {
      this.channel = null;
      this.model = null;
    }
  }
}
