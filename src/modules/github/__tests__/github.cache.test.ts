import { GitHubCache } from '../github.cache';
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
  body: null,
  html_url: 'https://github.com/golang/go/releases/tag/v1.22.0',
  published_at: '2024-02-06T00:00:00Z',
  draft: false,
  prerelease: false,
};

const TTL = 300;

const mockRedis = {
  get: jest.fn<Promise<string | null>, [string]>(),
  set: jest.fn<Promise<unknown>, [string, string, object]>(),
};

function createCache() {
  return new GitHubCache(mockRedis as any, TTL);
}

describe('GitHubCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRepo', () => {
    it('should return null on cache miss (redis returns null)', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await createCache().getRepo('golang', 'go');

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('github:repo:golang/go');
    });

    it('should return parsed object on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(mockRepo));

      const result = await createCache().getRepo('golang', 'go');

      expect(result).toEqual(mockRepo);
    });

    it('should return null and not throw when redis throws', async () => {
      mockRedis.get.mockRejectedValue(new Error('connection refused'));

      const result = await createCache().getRepo('golang', 'go');

      expect(result).toBeNull();
    });
  });

  describe('setRepo', () => {
    it('should call redis set with correct key, value and TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await createCache().setRepo('golang', 'go', mockRepo);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'github:repo:golang/go',
        JSON.stringify(mockRepo),
        { EX: TTL },
      );
    });

    it('should not throw when redis set throws', async () => {
      mockRedis.set.mockRejectedValue(new Error('connection refused'));

      await expect(createCache().setRepo('golang', 'go', mockRepo)).resolves.toBeUndefined();
    });
  });

  describe('getRelease', () => {
    it('should return undefined on cache miss (redis returns null — key absent)', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await createCache().getRelease('golang', 'go');

      // undefined = not cached yet (different from null = "no releases")
      expect(result).toBeUndefined();
      expect(mockRedis.get).toHaveBeenCalledWith('github:release:golang/go');
    });

    it('should return the release on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(mockRelease));

      const result = await createCache().getRelease('golang', 'go');

      expect(result).toEqual(mockRelease);
    });

    it('should return null when "no releases" sentinel is cached (redis returns string "null")', async () => {
      mockRedis.get.mockResolvedValue('null');

      const result = await createCache().getRelease('golang', 'go');

      // null = cached "repo has no releases" — distinct from undefined (cache miss)
      expect(result).toBeNull();
    });

    it('should return undefined and not throw when redis throws', async () => {
      mockRedis.get.mockRejectedValue(new Error('connection refused'));

      const result = await createCache().getRelease('golang', 'go');

      expect(result).toBeUndefined();
    });
  });

  describe('setRelease', () => {
    it('should store release as JSON string with TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await createCache().setRelease('golang', 'go', mockRelease);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'github:release:golang/go',
        JSON.stringify(mockRelease),
        { EX: TTL },
      );
    });

    it('should store null as string "null" (no-release sentinel)', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await createCache().setRelease('golang', 'go', null);

      expect(mockRedis.set).toHaveBeenCalledWith('github:release:golang/go', 'null', { EX: TTL });
    });

    it('should not throw when redis set throws', async () => {
      mockRedis.set.mockRejectedValue(new Error('connection refused'));

      await expect(createCache().setRelease('golang', 'go', null)).resolves.toBeUndefined();
    });
  });
});
