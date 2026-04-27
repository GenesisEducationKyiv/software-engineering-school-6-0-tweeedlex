import type IORedis from 'ioredis';
import { RateLimitError } from '../../../shared/errors/app-error';
import type { GitHubService } from '../../github/github.service';
import type { GitHubRelease } from '../../github/github.types';
import type { SubscriptionRepository } from '../../subscriptions/subscription.repository';
import { ScannerService } from '../scanner.service';

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({}),
  })),
}));

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

const mockRepo: jest.Mocked<SubscriptionRepository> = {
  findDistinctConfirmedRepos: jest.fn(),
  findAllConfirmedByRepoId: jest.fn(),
  updateRepoLastSeenTag: jest.fn(),
  findByEmailAndRepo: jest.fn(),
  create: jest.fn(),
  findByConfirmToken: jest.fn(),
  findByUnsubscribeToken: jest.fn(),
  confirmSubscription: jest.fn(),
  deleteSubscription: jest.fn(),
  findAllByEmail: jest.fn(),
  findOrCreateRepo: jest.fn(),
} as unknown as jest.Mocked<SubscriptionRepository>;

const mockGithubService: jest.Mocked<GitHubService> = {
  verifyRepo: jest.fn(),
  getLatestRelease: jest.fn(),
} as unknown as jest.Mocked<GitHubService>;

const mockBullConnection = {} as IORedis;

function createService() {
  return new ScannerService(mockRepo, mockGithubService, mockBullConnection);
}

describe('ScannerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should skip scanning when there are no repos with confirmed subscriptions', async () => {
    const service = createService();

    mockRepo.findDistinctConfirmedRepos.mockResolvedValue([]);

    await service.scanAllRepos();

    expect(mockGithubService.getLatestRelease).not.toHaveBeenCalled();
  });

  it('should skip repos with no releases', async () => {
    const service = createService();

    mockRepo.findDistinctConfirmedRepos.mockResolvedValue([
      { id: 'repo-1', owner: 'golang', name: 'go', lastSeenTag: null } as never,
    ]);
    mockGithubService.getLatestRelease.mockResolvedValue(null);

    await service.scanAllRepos();

    expect(mockRepo.updateRepoLastSeenTag).not.toHaveBeenCalled();
  });

  it('should detect new release and enqueue notifications', async () => {
    const service = createService();

    mockRepo.findDistinctConfirmedRepos.mockResolvedValue([
      { id: 'repo-1', owner: 'golang', name: 'go', lastSeenTag: 'v1.21.0' } as never,
    ]);
    mockGithubService.getLatestRelease.mockResolvedValue(mockRelease);
    mockRepo.findAllConfirmedByRepoId.mockResolvedValue([
      { id: 'sub-1', email: 'test@example.com', unsubscribeToken: 'unsub123' } as never,
    ]);
    mockRepo.updateRepoLastSeenTag.mockResolvedValue(undefined);

    await service.scanAllRepos();

    expect(mockRepo.updateRepoLastSeenTag).toHaveBeenCalledWith('repo-1', 'v1.22.0');
    expect(mockRepo.findAllConfirmedByRepoId).toHaveBeenCalledWith('repo-1');
  });

  it('should not update when release tag has not changed', async () => {
    const service = createService();

    mockRepo.findDistinctConfirmedRepos.mockResolvedValue([
      { id: 'repo-1', owner: 'golang', name: 'go', lastSeenTag: 'v1.22.0' } as never,
    ]);
    mockGithubService.getLatestRelease.mockResolvedValue(mockRelease);

    await service.scanAllRepos();

    expect(mockRepo.updateRepoLastSeenTag).not.toHaveBeenCalled();
    expect(mockRepo.findAllConfirmedByRepoId).not.toHaveBeenCalled();
  });

  it('should stop scanning on rate limit error', async () => {
    const service = createService();

    mockRepo.findDistinctConfirmedRepos.mockResolvedValue([
      { id: 'repo-1', owner: 'repo1', name: 'one', lastSeenTag: null } as never,
      { id: 'repo-2', owner: 'repo2', name: 'two', lastSeenTag: null } as never,
    ]);
    mockGithubService.getLatestRelease.mockRejectedValueOnce(new RateLimitError(3600));

    await service.scanAllRepos();

    // Should only have tried the first repo before hitting rate limit
    expect(mockGithubService.getLatestRelease).toHaveBeenCalledTimes(1);
  });
});
