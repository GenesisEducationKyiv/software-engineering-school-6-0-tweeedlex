import IORedis from 'ioredis';
import { config } from '../../config/env';
import { logger } from '../../config/logger';

let connection: IORedis | null = null;

export function getBullMQConnection(): IORedis {
  if (connection) {
    return connection;
  }

  connection = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  connection.on('error', (err) => {
    logger.error({ err }, 'BullMQ IORedis connection error');
  });

  connection.on('connect', () => {
    logger.info('BullMQ IORedis connected');
  });

  return connection;
}

export async function closeBullMQConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
