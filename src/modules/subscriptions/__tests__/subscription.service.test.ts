import type IORedis from 'ioredis';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/app-error';
import type { GitHubService } from '../../github/github.service';
import type { SubscriptionRepository } from '../subscription.repository';
import { SubscriptionService } from '../subscription.service';

// Mock BullMQ Queue
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({}),
  })),
}));

const mockRepo: jest.Mocked<SubscriptionRepository> = {
  findByEmailAndRepo: jest.fn(),
  create: jest.fn(),
  findByConfirmToken: jest.fn(),
  findByUnsubscribeToken: jest.fn(),
  confirmSubscription: jest.fn(),
  deleteSubscription: jest.fn(),
  findAllByEmail: jest.fn(),
  findOrCreateRepo: jest.fn(),
  findAllConfirmedByRepoId: jest.fn(),
  findDistinctConfirmedRepos: jest.fn(),
  updateRepoLastSeenTag: jest.fn(),
} as unknown as jest.Mocked<SubscriptionRepository>;

const mockGithubService: jest.Mocked<GitHubService> = {
  verifyRepo: jest.fn(),
  getLatestRelease: jest.fn(),
} as unknown as jest.Mocked<GitHubService>;

const mockBullConnection = {} as IORedis;

// Valid base64url token (43 chars, matches randomBytes(32).toString('base64url'))
const VALID_TOKEN = 'o65C424UZUrHdYEzXom7NUq0TnZpvdXVy4tK2S5gcj8';
const VALID_TOKEN_2 = 'jd4JxYg7eDkZ2uuNtzRUgWVmV3xzEOK3AQSgcviVSUM';

function createService() {
  return new SubscriptionService(mockRepo, mockGithubService, mockBullConnection);
}

describe('SubscriptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('subscribe', () => {
    it('should create a subscription successfully', async () => {
      const service = createService();

      mockGithubService.verifyRepo.mockResolvedValue({} as never);
      mockRepo.findOrCreateRepo.mockResolvedValue({
        id: 'repo-1',
        owner: 'golang',
        name: 'go',
      } as never);
      mockRepo.findByEmailAndRepo.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue({
        id: 'sub-1',
        email: 'test@example.com',
        repoId: 'repo-1',
        confirmed: false,
        confirmToken: 'token123',
        unsubscribeToken: 'unsub123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.subscribe('test@example.com', 'golang/go');

      expect(mockGithubService.verifyRepo).toHaveBeenCalledWith('golang', 'go');
      expect(mockRepo.findOrCreateRepo).toHaveBeenCalledWith('golang', 'go');
      expect(mockRepo.create).toHaveBeenCalled();
    });

    it('should throw ValidationError for invalid repo format', async () => {
      const service = createService();

      await expect(service.subscribe('test@example.com', 'invalid')).rejects.toThrow(
        ValidationError,
      );
      expect(mockGithubService.verifyRepo).not.toHaveBeenCalled();
    });

    it('should throw ConflictError for duplicate subscription', async () => {
      const service = createService();

      mockGithubService.verifyRepo.mockResolvedValue({} as never);
      mockRepo.findOrCreateRepo.mockResolvedValue({
        id: 'repo-1',
        owner: 'golang',
        name: 'go',
      } as never);
      mockRepo.findByEmailAndRepo.mockResolvedValue({ id: 'existing-sub' } as never);

      await expect(service.subscribe('test@example.com', 'golang/go')).rejects.toThrow(
        ConflictError,
      );
    });

    it('should propagate NotFoundError from GitHub service', async () => {
      const service = createService();

      mockGithubService.verifyRepo.mockRejectedValue(new NotFoundError('Repo not found'));

      await expect(service.subscribe('test@example.com', 'nonexistent/repo')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw ValidationError for invalid email in repo format check', async () => {
      const service = createService();

      // Double slash format
      await expect(service.subscribe('test@example.com', 'no-slash')).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('confirm', () => {
    it('should confirm a subscription successfully', async () => {
      const service = createService();

      mockRepo.findByConfirmToken.mockResolvedValue({
        id: 'sub-1',
        email: 'test@example.com',
        confirmToken: VALID_TOKEN,
        repo: { id: 'repo-1', owner: 'golang', name: 'go' },
      } as never);

      await service.confirm(VALID_TOKEN);

      expect(mockRepo.confirmSubscription).toHaveBeenCalledWith('sub-1');
    });

    it('should throw ValidationError for invalid token format', async () => {
      const service = createService();

      await expect(service.confirm('bad-token!')).rejects.toThrow(ValidationError);
      expect(mockRepo.findByConfirmToken).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError for unknown token', async () => {
      const service = createService();

      mockRepo.findByConfirmToken.mockResolvedValue(null);

      await expect(service.confirm(VALID_TOKEN)).rejects.toThrow(NotFoundError);
    });
  });

  describe('unsubscribe', () => {
    it('should delete a subscription successfully', async () => {
      const service = createService();

      mockRepo.findByUnsubscribeToken.mockResolvedValue({
        id: 'sub-1',
        email: 'test@example.com',
        unsubscribeToken: VALID_TOKEN_2,
        repo: { id: 'repo-1', owner: 'golang', name: 'go' },
      } as never);

      await service.unsubscribe(VALID_TOKEN_2);

      expect(mockRepo.deleteSubscription).toHaveBeenCalledWith('sub-1');
    });

    it('should throw ValidationError for invalid token format', async () => {
      const service = createService();

      await expect(service.unsubscribe('short')).rejects.toThrow(ValidationError);
      expect(mockRepo.findByUnsubscribeToken).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError for unknown token', async () => {
      const service = createService();

      mockRepo.findByUnsubscribeToken.mockResolvedValue(null);

      await expect(service.unsubscribe(VALID_TOKEN_2)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getSubscriptions', () => {
    it('should return subscriptions for a valid email', async () => {
      const service = createService();

      const mockSubs = [
        { email: 'test@example.com', repo: 'golang/go', confirmed: true, last_seen_tag: 'v1.22.0' },
      ];
      mockRepo.findAllByEmail.mockResolvedValue(mockSubs);

      const result = await service.getSubscriptions('test@example.com');

      expect(result).toEqual(mockSubs);
      expect(mockRepo.findAllByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should throw ValidationError for invalid email', async () => {
      const service = createService();

      await expect(service.getSubscriptions('not-an-email')).rejects.toThrow(ValidationError);
    });
  });
});
