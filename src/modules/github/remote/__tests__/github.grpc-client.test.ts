import { NotFoundError, RateLimitError } from '@/shared/errors/app-error';
import type { ILogger } from '@/shared/logger';
import * as grpc from '@grpc/grpc-js';

jest.mock('@/generated/proto/github', () => ({
  GitHubServiceClient: jest.fn().mockImplementation(() => ({
    verifyRepo: jest.fn(),
    getLatestRelease: jest.fn(),
  })),
}));

import { GitHubServiceClient } from '@/generated/proto/github';
import { GitHubGrpcClient } from '../github.grpc-client';

const mockLogger: jest.Mocked<ILogger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as jest.Mocked<ILogger>;

function makeClient() {
  const grpcClient = new GitHubGrpcClient({
    address: 'localhost:50062',
    apiKey: 'k',
    logger: mockLogger,
  });
  const MockClient = GitHubServiceClient as unknown as jest.Mock;
  const mockInstance = MockClient.mock.results[MockClient.mock.results.length - 1]
    .value as jest.Mocked<{ verifyRepo: jest.Mock; getLatestRelease: jest.Mock }>;
  return { grpc: grpcClient, mock: mockInstance };
}

describe('GitHubGrpcClient', () => {
  it('verifyRepo maps proto response to GitHubRepo', async () => {
    const { grpc: client, mock } = makeClient();
    const protoRepo = {
      id: 1,
      fullName: 'a/b',
      name: 'b',
      ownerLogin: 'a',
      description: '',
      htmlUrl: 'https://x',
      private: false,
    };
    mock.verifyRepo.mockImplementation((_req: unknown, _meta: unknown, cb: Function) =>
      cb(null, protoRepo),
    );
    const repo = await client.verifyRepo('a', 'b');
    expect(repo.full_name).toBe('a/b');
    expect(repo.owner.login).toBe('a');
  });

  it('verifyRepo maps NOT_FOUND to NotFoundError', async () => {
    const { grpc: client, mock } = makeClient();
    const err = Object.assign(new Error('nope'), { code: grpc.status.NOT_FOUND });
    mock.verifyRepo.mockImplementation((_req: unknown, _meta: unknown, cb: Function) =>
      cb(err, null),
    );
    await expect(client.verifyRepo('a', 'b')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('verifyRepo maps RESOURCE_EXHAUSTED to RateLimitError', async () => {
    const { grpc: client, mock } = makeClient();
    const err = Object.assign(new Error('rate'), { code: grpc.status.RESOURCE_EXHAUSTED });
    mock.verifyRepo.mockImplementation((_req: unknown, _meta: unknown, cb: Function) =>
      cb(err, null),
    );
    await expect(client.verifyRepo('a', 'b')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('getLatestRelease returns null when found=false', async () => {
    const { grpc: client, mock } = makeClient();
    mock.getLatestRelease.mockImplementation((_req: unknown, _meta: unknown, cb: Function) =>
      cb(null, { found: false }),
    );
    const result = await client.getLatestRelease('a', 'b');
    expect(result).toBeNull();
  });

  it('getLatestRelease maps release fields', async () => {
    const { grpc: client, mock } = makeClient();
    const release = {
      id: 1,
      tagName: 'v1',
      name: 'v1',
      body: '',
      htmlUrl: 'https://x',
      publishedAt: '2024',
      draft: false,
      prerelease: false,
    };
    mock.getLatestRelease.mockImplementation((_req: unknown, _meta: unknown, cb: Function) =>
      cb(null, { found: true, release }),
    );
    const result = await client.getLatestRelease('a', 'b');
    expect(result?.tag_name).toBe('v1');
  });
});
