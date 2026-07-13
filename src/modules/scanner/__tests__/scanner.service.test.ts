import { RateLimitError } from '../../../shared/errors/app-error';
import type { IEventBus } from '../../../shared/events';
import type { ILogger } from '../../../shared/logger';
import type { IMetricsCollector } from '../../../shared/metrics';
import type { GitHubService } from '../../github/github.service';
import type { GitHubRelease } from '../../github/github.types';
import type {
  IRepoRepository,
  ISubscriptionRepository,
} from '../../subscriptions/subscription.repository.interface';
import { ScannerService } from '../scanner.service';

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

const mockSubscriptionRepo: jest.Mocked<ISubscriptionRepository> = {
  findByEmailAndRepo: jest.fn(),
  create: jest.fn(),
  findByConfirmToken: jest.fn(),
  findByUnsubscribeToken: jest.fn(),
  confirmSubscription: jest.fn(),
  deleteSubscription: jest.fn(),
  findAllByEmail: jest.fn(),
  findAllConfirmedByRepoId: jest.fn(),
} as unknown as jest.Mocked<ISubscriptionRepository>;

const mockRepoRepo: jest.Mocked<IRepoRepository> = {
  findOrCreate: jest.fn(),
  findDistinctConfirmed: jest.fn(),
  updateLastSeenTag: jest.fn(),
} as unknown as jest.Mocked<IRepoRepository>;

const mockGithubService: jest.Mocked<GitHubService> = {
  verifyRepo: jest.fn(),
  getLatestRelease: jest.fn(),
} as unknown as jest.Mocked<GitHubService>;

const mockEventBus: jest.Mocked<IEventBus> = {
  publish: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn(),
} as unknown as jest.Mocked<IEventBus>;

const mockMetrics: jest.Mocked<IMetricsCollector> = {
  incrementCounter: jest.fn(),
  observeHistogram: jest.fn(),
  setGauge: jest.fn(),
  incrementGauge: jest.fn(),
  decrementGauge: jest.fn(),
  render: jest.fn(),
} as unknown as jest.Mocked<IMetricsCollector>;

const mockLogger: jest.Mocked<ILogger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as jest.Mocked<ILogger>;

function createService() {
  return new ScannerService(
    mockSubscriptionRepo,
    mockRepoRepo,
    mockGithubService,
    mockEventBus,
    mockMetrics,
    mockLogger,
  );
}

describe('ScannerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should skip scanning when there are no repos with confirmed subscriptions', async () => {
    const service = createService();

    mockRepoRepo.findDistinctConfirmed.mockResolvedValue([]);

    await service.scanAllRepos();

    expect(mockGithubService.getLatestRelease).not.toHaveBeenCalled();
  });

  it('should skip repos with no releases', async () => {
    const service = createService();

    mockRepoRepo.findDistinctConfirmed.mockResolvedValue([
      { id: 'repo-1', owner: 'golang', name: 'go', lastSeenTag: null } as never,
    ]);
    mockGithubService.getLatestRelease.mockResolvedValue(null);

    await service.scanAllRepos();

    expect(mockRepoRepo.updateLastSeenTag).not.toHaveBeenCalled();
  });

  it('should detect new release and publish event', async () => {
    const service = createService();

    mockRepoRepo.findDistinctConfirmed.mockResolvedValue([
      { id: 'repo-1', owner: 'golang', name: 'go', lastSeenTag: 'v1.21.0' } as never,
    ]);
    mockGithubService.getLatestRelease.mockResolvedValue(mockRelease);
    mockSubscriptionRepo.findAllConfirmedByRepoId.mockResolvedValue([
      { id: 'sub-1', email: 'test@example.com', unsubscribeToken: 'unsub123' } as never,
    ]);
    mockRepoRepo.updateLastSeenTag.mockResolvedValue(undefined);

    await service.scanAllRepos();

    expect(mockRepoRepo.updateLastSeenTag).toHaveBeenCalledWith('repo-1', 'v1.22.0');
    expect(mockSubscriptionRepo.findAllConfirmedByRepoId).toHaveBeenCalledWith('repo-1');
    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scanner.new-release-detected',
        repoSlug: 'golang/go',
      }),
    );
  });

  it('should not update when release tag has not changed', async () => {
    const service = createService();

    mockRepoRepo.findDistinctConfirmed.mockResolvedValue([
      { id: 'repo-1', owner: 'golang', name: 'go', lastSeenTag: 'v1.22.0' } as never,
    ]);
    mockGithubService.getLatestRelease.mockResolvedValue(mockRelease);

    await service.scanAllRepos();

    expect(mockRepoRepo.updateLastSeenTag).not.toHaveBeenCalled();
    expect(mockSubscriptionRepo.findAllConfirmedByRepoId).not.toHaveBeenCalled();
  });

  it('should stop scanning on rate limit error', async () => {
    const service = createService();

    mockRepoRepo.findDistinctConfirmed.mockResolvedValue([
      { id: 'repo-1', owner: 'repo1', name: 'one', lastSeenTag: null } as never,
      { id: 'repo-2', owner: 'repo2', name: 'two', lastSeenTag: null } as never,
    ]);
    mockGithubService.getLatestRelease.mockRejectedValueOnce(new RateLimitError(3600));

    await service.scanAllRepos();

    // Should only have tried the first repo before hitting rate limit
    expect(mockGithubService.getLatestRelease).toHaveBeenCalledTimes(1);
  });

  it('should not update lastSeenTag if event publish fails', async () => {
    const service = createService();

    mockRepoRepo.findDistinctConfirmed.mockResolvedValue([
      { id: 'repo-1', owner: 'golang', name: 'go', lastSeenTag: 'v1.21.0' } as never,
    ]);
    mockGithubService.getLatestRelease.mockResolvedValue(mockRelease);
    mockSubscriptionRepo.findAllConfirmedByRepoId.mockResolvedValue([]);
    mockEventBus.publish.mockRejectedValueOnce(new Error('bus error'));

    await service.scanAllRepos();

    expect(mockRepoRepo.updateLastSeenTag).not.toHaveBeenCalled();
  });

  it('should return scan result with counts', async () => {
    const service = createService();

    mockRepoRepo.findDistinctConfirmed.mockResolvedValue([
      { id: 'repo-1', owner: 'golang', name: 'go', lastSeenTag: 'v1.21.0' } as never,
    ]);
    mockGithubService.getLatestRelease.mockResolvedValue(mockRelease);
    mockSubscriptionRepo.findAllConfirmedByRepoId.mockResolvedValue([]);
    mockRepoRepo.updateLastSeenTag.mockResolvedValue(undefined);

    const result = await service.scanAllRepos();

    expect(result.scanned).toBe(1);
    expect(result.newReleases).toBe(1);
  });
});
