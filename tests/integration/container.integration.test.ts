import 'reflect-metadata';
import { buildContainer } from '@/composition/container';
import { config } from '@/config/env';
import { SCANNER_SERVICE } from '@/modules/scanner';
import { SUBSCRIPTION_SERVICE } from '@/modules/subscriptions';
import { PinoLogger } from '@/shared/logger';

describe('buildContainer (integration)', () => {
  it('resolves core service tokens and starts cleanly', async () => {
    const logger = PinoLogger.create({ level: 'silent', pretty: false });
    const graph = await buildContainer(config, logger);
    expect(graph.container.isRegistered(SUBSCRIPTION_SERVICE)).toBe(true);
    expect(graph.container.isRegistered(SCANNER_SERVICE)).toBe(true);
    expect(graph.container.resolve(SUBSCRIPTION_SERVICE)).toBeDefined();
    // cleanup connections
    await graph.scannerWorker.close();
    await graph.bullmq.close();
    await graph.redis.quit();
    await graph.prisma.$disconnect();
  });
});
