import * as grpc from '@grpc/grpc-js';
import { NotFoundError } from '@/shared/errors/app-error';
import type { GitHubRepo } from '@/modules/github';
import { PinoLogger } from '@/shared/logger';
import { buildGithubGrpcServer, startGrpcServer } from '../server';

const repo: GitHubRepo = {
  id: 1,
  full_name: 'a/b',
  name: 'b',
  owner: { login: 'a' },
  description: null,
  html_url: 'https://x',
  private: false,
};

function makeServer(over: Partial<{ verifyRepo: jest.Mock }> = {}) {
  const service = {
    verifyRepo: over.verifyRepo ?? jest.fn().mockResolvedValue(repo),
    getLatestRelease: jest.fn().mockResolvedValue(null),
  };
  const logger = PinoLogger.create({ level: 'silent', pretty: false, base: { service: 'test' } });
  return {
    server: buildGithubGrpcServer({ service: service as never, apiKey: 'k', logger }),
    service,
  };
}

describe('github gRPC server', () => {
  it('builds without throwing', () => {
    const { server } = makeServer();
    expect(server).toBeDefined();
    server.forceShutdown();
  });
});
