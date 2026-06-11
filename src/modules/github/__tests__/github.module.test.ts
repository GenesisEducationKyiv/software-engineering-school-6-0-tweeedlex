import 'reflect-metadata';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { REDIS, registerInfraModule } from '@/infrastructure/infra.module';
import { PinoLogger } from '@/shared/logger';
import { container } from 'tsyringe';
import { GITHUB_SERVICE, registerGithubModule } from '../github.module';
import { GitHubService } from '../github.service';

describe('registerGithubModule', () => {
  it('resolves GITHUB_SERVICE to a GitHubService instance', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, {
      githubToken: undefined,
      githubApiBaseUrl: 'https://api.github.com',
      githubCacheTtlSeconds: 600,
    } as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent', pretty: false }));
    c.registerInstance(REDIS, { get: async () => null, set: async () => 'OK' } as never);
    registerInfraModule(c);
    registerGithubModule(c);
    expect(c.resolve(GITHUB_SERVICE)).toBeInstanceOf(GitHubService);
  });
});
