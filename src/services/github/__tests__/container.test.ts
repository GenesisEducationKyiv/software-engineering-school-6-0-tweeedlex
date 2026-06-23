import { loadGithubServiceConfig } from '@/config/github-env';
import { PinoLogger } from '@/shared/logger';
import { buildGithubGraph } from '../container';

jest.mock('@/infrastructure/redis/redis-factory', () => ({
  createRedisClient: jest.fn().mockResolvedValue({
    quit: jest.fn().mockResolvedValue(undefined),
  }),
}));

describe('buildGithubGraph', () => {
  it('exposes service + start/close', async () => {
    process.env.API_KEY = 'k';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const logger = PinoLogger.create({ level: 'silent', pretty: false, base: { service: 'test' } });
    const graph = await buildGithubGraph(loadGithubServiceConfig(), logger);
    expect(typeof graph.service.verifyRepo).toBe('function');
    expect(typeof graph.start).toBe('function');
    expect(typeof graph.close).toBe('function');
    await graph.close().catch(() => undefined);
  });
});
