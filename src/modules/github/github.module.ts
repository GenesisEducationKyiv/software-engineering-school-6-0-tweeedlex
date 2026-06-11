import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import type { Config } from '@/config/env';
import { METRICS, REDIS } from '@/infrastructure/infra.module';
import type { RedisClient } from '@/infrastructure/redis/redis-factory';
import type { ILogger } from '@/shared/logger';
import type { IMetricsCollector } from '@/shared/metrics';
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import { GitHubCache } from './github.cache';
import { GitHubClient } from './github.client';
import { GitHubService } from './github.service';
import type { GitHubRelease, GitHubRepo } from './github.types';

export interface IGitHubService {
  verifyRepo(owner: string, name: string): Promise<GitHubRepo>;
  getLatestRelease(
    owner: string,
    name: string,
    bypassCache?: boolean,
  ): Promise<GitHubRelease | null>;
}

export const GITHUB_CLIENT: InjectionToken<GitHubClient> = Symbol('GITHUB_CLIENT');
export const GITHUB_CACHE: InjectionToken<GitHubCache> = Symbol('GITHUB_CACHE');
export const GITHUB_SERVICE: InjectionToken<IGitHubService> = Symbol('GITHUB_SERVICE');

export type { GitHubRepo, GitHubRelease } from './github.types';

export function registerGithubModule(c: DependencyContainer): void {
  c.register(GITHUB_CLIENT, {
    useFactory: (dep) => {
      const config = dep.resolve<Config>(CONFIG);
      const logger = dep
        .resolve<ILogger>(ROOT_LOGGER)
        .child({ module: 'github', component: 'client' });
      const metrics = dep.resolve<IMetricsCollector>(METRICS);
      return new GitHubClient(config.githubToken, logger, metrics, config.githubApiBaseUrl);
    },
  });
  c.register(GITHUB_CACHE, {
    useFactory: (dep) => {
      const config = dep.resolve<Config>(CONFIG);
      const logger = dep
        .resolve<ILogger>(ROOT_LOGGER)
        .child({ module: 'github', component: 'cache' });
      const redis = dep.resolve<RedisClient>(REDIS);
      return new GitHubCache(redis, config.githubCacheTtlSeconds, logger);
    },
  });
  c.register(GITHUB_SERVICE, {
    useFactory: (dep) => new GitHubService(dep.resolve(GITHUB_CLIENT), dep.resolve(GITHUB_CACHE)),
  });
}
