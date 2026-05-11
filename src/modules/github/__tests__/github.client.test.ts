import { NotFoundError, RateLimitError } from '../../../shared/errors/app-error';
import type { ILogger } from '../../../shared/logger';
import type { IMetricsCollector } from '../../../shared/metrics';
import { GitHubClient } from '../github.client';
import type { GitHubRelease, GitHubRepo } from '../github.types';

const mockRepo: GitHubRepo = {
  id: 1,
  full_name: 'golang/go',
  name: 'go',
  owner: { login: 'golang' },
  description: 'The Go programming language',
  html_url: 'https://github.com/golang/go',
  private: false,
};

const mockRelease: GitHubRelease = {
  id: 1,
  tag_name: 'v1.22.0',
  name: 'Go 1.22',
  body: 'Release notes...',
  html_url: 'https://github.com/golang/go/releases/tag/v1.22.0',
  published_at: '2024-02-06T00:00:00Z',
  draft: false,
  prerelease: false,
};

function makeFetchResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const headerMap = new Map(Object.entries(headers));
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    headers: {
      get: (key: string) => headerMap.get(key) ?? null,
    },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const safeHeaders = {
  'X-RateLimit-Remaining': '60',
  'X-RateLimit-Reset': '0',
  'X-RateLimit-Limit': '60',
};

const mockLogger: jest.Mocked<ILogger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as jest.Mocked<ILogger>;

const mockMetrics: jest.Mocked<IMetricsCollector> = {
  incrementCounter: jest.fn(),
  observeHistogram: jest.fn(),
  setGauge: jest.fn(),
  render: jest.fn(),
} as unknown as jest.Mocked<IMetricsCollector>;

function createClient(token?: string) {
  return new GitHubClient(token, mockLogger, mockMetrics);
}

describe('GitHubClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe('constructor', () => {
    it('should include Authorization header when token is provided', async () => {
      const client = createClient('my-token');
      (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(200, mockRepo, safeHeaders));

      await client.getRepo('golang', 'go');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(options.headers.Authorization).toBe('token my-token');
    });

    it('should not include Authorization header when no token', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(200, mockRepo, safeHeaders));

      await client.getRepo('golang', 'go');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(options.headers.Authorization).toBeUndefined();
    });
  });

  describe('getRepo', () => {
    it('should return repo on 200 response', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(200, mockRepo, safeHeaders));

      const result = await client.getRepo('golang', 'go');

      expect(result).toEqual(mockRepo);
    });

    it('should throw NotFoundError on 404', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(404, {}));

      await expect(client.getRepo('nonexistent', 'repo')).rejects.toThrow(NotFoundError);
    });

    it('should throw RateLimitError on 429 with Retry-After header', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(
        makeFetchResponse(429, {}, { 'Retry-After': '120' }),
      );

      const err = await client.getRepo('golang', 'go').catch((e) => e);
      expect(err).toBeInstanceOf(RateLimitError);
      expect(err.retryAfter).toBe(120);
    });

    it('should throw RateLimitError on 403 with X-RateLimit-Remaining: 0', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(
        makeFetchResponse(403, {}, { 'X-RateLimit-Remaining': '0' }),
      );

      await expect(client.getRepo('golang', 'go')).rejects.toThrow(RateLimitError);
    });

    it('should throw generic Error on 403 without rate limit header', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(403, {}));

      await expect(client.getRepo('golang', 'go')).rejects.toThrow('GitHub API error: 403');
      await expect(client.getRepo('golang', 'go')).rejects.not.toThrow(RateLimitError);
    });

    it('should throw generic Error on 500', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(500, {}));

      await expect(client.getRepo('golang', 'go')).rejects.toThrow('GitHub API error: 500');
    });

    it('should throw RateLimitError via handleRateLimit when remaining < 5 on success response', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(
        makeFetchResponse(200, mockRepo, {
          'X-RateLimit-Remaining': '2',
          'X-RateLimit-Reset': '0',
          'X-RateLimit-Limit': '60',
        }),
      );

      await expect(client.getRepo('golang', 'go')).rejects.toThrow(RateLimitError);
    });

    it('should increment metrics counter on each API call', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(200, mockRepo, safeHeaders));

      await client.getRepo('golang', 'go');

      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ endpoint: '/repos/golang/go', status: '200' }),
      );
    });
  });

  describe('getLatestRelease', () => {
    it('should return release on 200 response', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(
        makeFetchResponse(200, mockRelease, safeHeaders),
      );

      const result = await client.getLatestRelease('golang', 'go');

      expect(result).toEqual(mockRelease);
    });

    it('should return null on 404 (repo has no releases)', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(404, {}));

      const result = await client.getLatestRelease('golang', 'go');

      expect(result).toBeNull();
    });

    it('should throw RateLimitError on 429', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(
        makeFetchResponse(429, {}, { 'Retry-After': '60' }),
      );

      await expect(client.getLatestRelease('golang', 'go')).rejects.toThrow(RateLimitError);
    });

    it('should throw RateLimitError on 403 with X-RateLimit-Remaining: 0', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(
        makeFetchResponse(403, {}, { 'X-RateLimit-Remaining': '0' }),
      );

      await expect(client.getLatestRelease('golang', 'go')).rejects.toThrow(RateLimitError);
    });

    it('should throw generic Error on 500', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(500, {}));

      await expect(client.getLatestRelease('golang', 'go')).rejects.toThrow(
        'GitHub API error: 500',
      );
    });

    it('should throw RateLimitError via handleRateLimit when remaining < 5 on success response', async () => {
      const client = createClient();
      (global.fetch as jest.Mock).mockResolvedValue(
        makeFetchResponse(200, mockRelease, {
          'X-RateLimit-Remaining': '2',
          'X-RateLimit-Reset': '0',
          'X-RateLimit-Limit': '60',
        }),
      );

      await expect(client.getLatestRelease('golang', 'go')).rejects.toThrow(RateLimitError);
    });
  });
});
