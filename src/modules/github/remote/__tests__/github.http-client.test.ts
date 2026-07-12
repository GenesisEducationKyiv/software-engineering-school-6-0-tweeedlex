import type { ILogger } from '@/shared/logger';
import { NotFoundError, RateLimitError } from '@/shared/errors/app-error';
import { GitHubHttpClient } from '../github.http-client';

const mockLogger: jest.Mocked<ILogger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as jest.Mocked<ILogger>;

function makeClient(fetchImpl: jest.Mock) {
  global.fetch = fetchImpl;
  return new GitHubHttpClient({ baseUrl: 'http://gh-svc', apiKey: 'k', logger: mockLogger });
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: () => Promise.resolve(body),
  } as Response);
}

describe('GitHubHttpClient', () => {
  it('verifyRepo returns repo on 200', async () => {
    const repo = { id: 1, full_name: 'a/b', name: 'b', owner: { login: 'a' }, description: null, html_url: 'https://x', private: false };
    const client = makeClient(jest.fn().mockReturnValue(jsonResponse(repo)));
    const result = await client.verifyRepo('a', 'b');
    expect(result.full_name).toBe('a/b');
  });

  it('verifyRepo throws NotFoundError on 404', async () => {
    const client = makeClient(jest.fn().mockReturnValue(jsonResponse({ message: 'nope' }, 404)));
    await expect(client.verifyRepo('a', 'b')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('verifyRepo throws RateLimitError on 429', async () => {
    const client = makeClient(jest.fn().mockReturnValue(jsonResponse({ message: 'rate' }, 429)));
    await expect(client.verifyRepo('a', 'b')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('getLatestRelease returns null when found=false', async () => {
    const client = makeClient(jest.fn().mockReturnValue(jsonResponse({ found: false, release: null })));
    const result = await client.getLatestRelease('a', 'b');
    expect(result).toBeNull();
  });

  it('getLatestRelease returns release when found=true', async () => {
    const release = { id: 1, tag_name: 'v1', name: 'v1', body: '', html_url: 'https://x', published_at: '2024-01-01', draft: false, prerelease: false };
    const client = makeClient(jest.fn().mockReturnValue(jsonResponse({ found: true, release })));
    const result = await client.getLatestRelease('a', 'b');
    expect(result?.tag_name).toBe('v1');
  });
});
