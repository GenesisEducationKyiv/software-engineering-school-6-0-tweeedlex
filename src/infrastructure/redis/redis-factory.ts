import type { ILogger } from '@/shared/logger';
import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

export async function createRedisClient(redisUrl: string, logger: ILogger): Promise<RedisClient> {
  const client = createClient({ url: redisUrl });
  client.on('error', (err) => logger.error({ err }, 'Redis client error'));
  client.on('connect', () => logger.info('Redis connected'));
  await client.connect();
  return client;
}
