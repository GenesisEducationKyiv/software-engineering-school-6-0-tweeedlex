import IORedis from 'ioredis';
import type { ILogger } from '../../logger';

export class BullMQConnection {
  private connection: IORedis;

  constructor(redisUrl: string, logger: ILogger) {
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.connection.on('error', (err) => logger.error({ err }, 'BullMQ IORedis connection error'));
    this.connection.on('connect', () => logger.info('BullMQ IORedis connected'));
  }

  getConnection(): IORedis {
    return this.connection;
  }

  async close(): Promise<void> {
    await this.connection.quit();
  }
}
