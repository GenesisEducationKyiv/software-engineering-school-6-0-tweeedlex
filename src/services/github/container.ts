import type { GithubServiceConfig } from '@/config/github-env';
import { createRedisClient } from '@/infrastructure/redis/redis-factory';
import { GitHubCache } from '@/modules/github/github.cache';
import { GitHubClient } from '@/modules/github/github.client';
import { GitHubService } from '@/modules/github/github.service';
import type { ILogger } from '@/shared/logger';
import { METRIC_DEFINITIONS, PrometheusMetricsCollector } from '@/shared/metrics';

export interface GithubGraph {
  service: GitHubService;
  metrics: PrometheusMetricsCollector;
  start: () => Promise<void>;
  close: () => Promise<void>;
}

export async function buildGithubGraph(
  config: GithubServiceConfig,
  logger: ILogger,
): Promise<GithubGraph> {
  const metrics = new PrometheusMetricsCollector(METRIC_DEFINITIONS, {
    defaultMetricsPrefix: 'gh_',
  });
  const redis = await createRedisClient(config.redisUrl, logger.child({ component: 'redis' }));
  const client = new GitHubClient(
    config.githubToken,
    logger.child({ component: 'github-client' }),
    metrics,
    config.githubApiBaseUrl,
  );
  const cache = new GitHubCache(
    redis,
    config.githubCacheTtlSeconds,
    logger.child({ component: 'github-cache' }),
  );
  const service = new GitHubService(client, cache);

  return {
    service,
    metrics,
    start: async () => {},
    close: async () => {
      await redis.quit().catch(() => undefined);
    },
  };
}
