import 'reflect-metadata';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { PinoLogger } from '@/shared/logger';
import { container } from 'tsyringe';
import { GITHUB_SERVICE, registerGithubModule } from '../github.module';
import { GitHubGrpcClient } from '../remote/github.grpc-client';
import { GitHubHttpClient } from '../remote/github.http-client';

const baseConfig = {
  apiKey: 'test-key',
  githubServiceHttpUrl: 'http://localhost:3200',
  githubGrpcAddr: 'localhost:50062',
};

describe('registerGithubModule', () => {
  it('resolves GITHUB_SERVICE to GitHubGrpcClient when transport is grpc', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, { ...baseConfig, githubTransport: 'grpc' } as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent', pretty: false }));
    registerGithubModule(c);
    expect(c.resolve(GITHUB_SERVICE)).toBeInstanceOf(GitHubGrpcClient);
  });

  it('resolves GITHUB_SERVICE to GitHubHttpClient when transport is http', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, { ...baseConfig, githubTransport: 'http' } as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent', pretty: false }));
    registerGithubModule(c);
    expect(c.resolve(GITHUB_SERVICE)).toBeInstanceOf(GitHubHttpClient);
  });
});
