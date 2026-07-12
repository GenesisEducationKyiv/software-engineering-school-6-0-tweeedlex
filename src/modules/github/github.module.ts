import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import type { Config } from '@/config/env';
import type { ILogger } from '@/shared/logger';
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import { GitHubGrpcClient } from './remote/github.grpc-client';
import { GitHubHttpClient } from './remote/github.http-client';
import type { GitHubRelease, GitHubRepo } from './github.types';

export interface IGitHubService {
  verifyRepo(owner: string, name: string): Promise<GitHubRepo>;
  getLatestRelease(
    owner: string,
    name: string,
    bypassCache?: boolean,
  ): Promise<GitHubRelease | null>;
}

export const GITHUB_SERVICE: InjectionToken<IGitHubService> = Symbol('GITHUB_SERVICE');

export type { GitHubRepo, GitHubRelease } from './github.types';

export function registerGithubModule(c: DependencyContainer): void {
  c.register(GITHUB_SERVICE, {
    useFactory: (dep) => {
      const config = dep.resolve<Config>(CONFIG);
      const logger = dep.resolve<ILogger>(ROOT_LOGGER).child({ module: 'github' });
      if (config.githubTransport === 'grpc') {
        return new GitHubGrpcClient({ address: config.githubGrpcAddr, apiKey: config.apiKey, logger });
      }
      return new GitHubHttpClient({ baseUrl: config.githubServiceHttpUrl, apiKey: config.apiKey, logger });
    },
  });
}
