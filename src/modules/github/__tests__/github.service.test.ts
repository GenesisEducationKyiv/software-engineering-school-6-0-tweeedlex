import { NotFoundError, RateLimitError } from '../../../shared/errors/app-error';
import type { GitHubCache } from '../github.cache';
import type { GitHubClient } from '../github.client';
import { GitHubService } from '../github.service';
import type { GitHubRelease, GitHubRepo } from '../github.types';

const mockGitHubRepo: GitHubRepo = {
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

const mockClient: jest.Mocked<GitHubClient> = {
  getRepo: jest.fn(),
  getLatestRelease: jest.fn(),
} as unknown as jest.Mocked<GitHubClient>;

const mockCache: jest.Mocked<GitHubCache> = {
  getRepo: jest.fn(),
  setRepo: jest.fn(),
  getRelease: jest.fn(),
  setRelease: jest.fn(),
} as unknown as jest.Mocked<GitHubCache>;

function createService() {
  return new GitHubService(mockClient, mockCache);
}

describe('GitHubService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyRepo', () => {
    it('should return cached repo when available', async () => {
      const service = createService();

      mockCache.getRepo.mockResolvedValue(mockGitHubRepo);

      const result = await service.verifyRepo('golang', 'go');

      expect(result).toEqual(mockGitHubRepo);
      expect(mockClient.getRepo).not.toHaveBeenCalled();
      expect(mockCache.setRepo).not.toHaveBeenCalled();
    });

    it('should call GitHub API and cache result on cache miss', async () => {
      const service = createService();

      mockCache.getRepo.mockResolvedValue(null);
      mockClient.getRepo.mockResolvedValue(mockGitHubRepo);
      mockCache.setRepo.mockResolvedValue(undefined);

      const result = await service.verifyRepo('golang', 'go');

      expect(result).toEqual(mockGitHubRepo);
      expect(mockClient.getRepo).toHaveBeenCalledWith('golang', 'go');
      expect(mockCache.setRepo).toHaveBeenCalledWith('golang', 'go', mockGitHubRepo);
    });

    it('should propagate NotFoundError when repo does not exist', async () => {
      const service = createService();

      mockCache.getRepo.mockResolvedValue(null);
      mockClient.getRepo.mockRejectedValue(new NotFoundError('Not found'));

      await expect(service.verifyRepo('nonexistent', 'repo')).rejects.toThrow(NotFoundError);
    });

    it('should propagate RateLimitError', async () => {
      const service = createService();

      mockCache.getRepo.mockResolvedValue(null);
      mockClient.getRepo.mockRejectedValue(new RateLimitError(3600));

      await expect(service.verifyRepo('golang', 'go')).rejects.toThrow(RateLimitError);
    });
  });

  describe('getLatestRelease', () => {
    it('should return cached release on cache hit', async () => {
      const service = createService();

      mockCache.getRelease.mockResolvedValue(mockRelease);

      const result = await service.getLatestRelease('golang', 'go');

      expect(result).toEqual(mockRelease);
      expect(mockClient.getLatestRelease).not.toHaveBeenCalled();
      expect(mockCache.setRelease).not.toHaveBeenCalled();
    });

    it('should return cached null when repo has no releases (cache hit)', async () => {
      const service = createService();

      mockCache.getRelease.mockResolvedValue(null);

      const result = await service.getLatestRelease('empty', 'repo');

      expect(result).toBeNull();
      expect(mockClient.getLatestRelease).not.toHaveBeenCalled();
    });

    it('should call GitHub API and cache result on cache miss', async () => {
      const service = createService();

      mockCache.getRelease.mockResolvedValue(undefined);
      mockClient.getLatestRelease.mockResolvedValue(mockRelease);
      mockCache.setRelease.mockResolvedValue(undefined);

      const result = await service.getLatestRelease('golang', 'go');

      expect(result).toEqual(mockRelease);
      expect(mockClient.getLatestRelease).toHaveBeenCalledWith('golang', 'go');
      expect(mockCache.setRelease).toHaveBeenCalledWith('golang', 'go', mockRelease);
    });

    it('should cache null when repo has no releases', async () => {
      const service = createService();

      mockCache.getRelease.mockResolvedValue(undefined);
      mockClient.getLatestRelease.mockResolvedValue(null);
      mockCache.setRelease.mockResolvedValue(undefined);

      const result = await service.getLatestRelease('empty', 'repo');

      expect(result).toBeNull();
      expect(mockCache.setRelease).toHaveBeenCalledWith('empty', 'repo', null);
    });

    it('should bypass cache when bypassCache is true', async () => {
      const service = createService();

      mockClient.getLatestRelease.mockResolvedValue(mockRelease);

      const result = await service.getLatestRelease('golang', 'go', true);

      expect(result).toEqual(mockRelease);
      expect(mockCache.getRelease).not.toHaveBeenCalled();
      expect(mockCache.setRelease).not.toHaveBeenCalled();
      expect(mockClient.getLatestRelease).toHaveBeenCalledWith('golang', 'go');
    });

    it('should propagate RateLimitError', async () => {
      const service = createService();

      mockCache.getRelease.mockResolvedValue(undefined);
      mockClient.getLatestRelease.mockRejectedValue(new RateLimitError(600));

      await expect(service.getLatestRelease('golang', 'go')).rejects.toThrow(RateLimitError);
    });
  });
});
