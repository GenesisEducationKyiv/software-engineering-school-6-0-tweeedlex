import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/app-error';
import type { ILogger } from '../../../shared/logger';
import type { GitHubService } from '../../github/github.service';
import type {
  IRepoRepository,
  ISubscriptionRepository,
} from '../subscription.repository.interface';
import { SubscriptionService } from '../subscription.service';
import { SubscriptionValidator } from '../subscription.validator';

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

const mockLogger: jest.Mocked<ILogger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as jest.Mocked<ILogger>;

const mockSaga = { start: jest.fn().mockResolvedValue('saga-1') };
const mockPrismaTransaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb({ __tx: true }));
const mockPrisma = { $transaction: mockPrismaTransaction } as never;

// Valid base64url token (43 chars, matches randomBytes(32).toString('base64url'))
const VALID_TOKEN = 'o65C424UZUrHdYEzXom7NUq0TnZpvdXVy4tK2S5gcj8';
const VALID_TOKEN_2 = 'jd4JxYg7eDkZ2uuNtzRUgWVmV3xzEOK3AQSgcviVSUM';

function createService() {
  return new SubscriptionService(
    mockSubscriptionRepo,
    mockRepoRepo,
    mockGithubService,
    new SubscriptionValidator(),
    mockPrisma,
    mockSaga,
    mockLogger,
  );
}

describe('SubscriptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({ __tx: true }),
    );
    mockSaga.start.mockResolvedValue('saga-1');
  });

  describe('subscribe', () => {
    it('should create a subscription successfully', async () => {
      const service = createService();

      mockGithubService.verifyRepo.mockResolvedValue({} as never);
      mockRepoRepo.findOrCreate.mockResolvedValue({
        id: 'repo-1',
        owner: 'golang',
        name: 'go',
      } as never);
      mockSubscriptionRepo.findByEmailAndRepo.mockResolvedValue(null);
      mockSubscriptionRepo.create.mockResolvedValue({
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
      expect(mockRepoRepo.findOrCreate).toHaveBeenCalledWith('golang', 'go');
      expect(mockSubscriptionRepo.create).toHaveBeenCalled();
    });

    it('should start the saga inside the transaction on success', async () => {
      const service = createService();

      mockGithubService.verifyRepo.mockResolvedValue({} as never);
      mockRepoRepo.findOrCreate.mockResolvedValue({
        id: 'repo-1',
        owner: 'golang',
        name: 'go',
      } as never);
      mockSubscriptionRepo.findByEmailAndRepo.mockResolvedValue(null);
      mockSubscriptionRepo.create.mockResolvedValue({
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

      expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
      expect(mockSaga.start).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          email: 'test@example.com',
          repoSlug: 'golang/go',
        }),
        expect.anything(),
      );
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
      mockRepoRepo.findOrCreate.mockResolvedValue({
        id: 'repo-1',
        owner: 'golang',
        name: 'go',
      } as never);
      mockSubscriptionRepo.findByEmailAndRepo.mockResolvedValue({ id: 'existing-sub' } as never);

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

      mockSubscriptionRepo.findByConfirmToken.mockResolvedValue({
        id: 'sub-1',
        email: 'test@example.com',
        confirmToken: VALID_TOKEN,
        repo: { id: 'repo-1', owner: 'golang', name: 'go' },
      } as never);

      await service.confirm(VALID_TOKEN);

      expect(mockSubscriptionRepo.confirmSubscription).toHaveBeenCalledWith('sub-1');
    });

    it('should throw ValidationError for invalid token format', async () => {
      const service = createService();

      await expect(service.confirm('bad-token!')).rejects.toThrow(ValidationError);
      expect(mockSubscriptionRepo.findByConfirmToken).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError for unknown token', async () => {
      const service = createService();

      mockSubscriptionRepo.findByConfirmToken.mockResolvedValue(null);

      await expect(service.confirm(VALID_TOKEN)).rejects.toThrow(NotFoundError);
    });
  });

  describe('unsubscribe', () => {
    it('should delete a subscription successfully', async () => {
      const service = createService();

      mockSubscriptionRepo.findByUnsubscribeToken.mockResolvedValue({
        id: 'sub-1',
        email: 'test@example.com',
        unsubscribeToken: VALID_TOKEN_2,
        repo: { id: 'repo-1', owner: 'golang', name: 'go' },
      } as never);

      await service.unsubscribe(VALID_TOKEN_2);

      expect(mockSubscriptionRepo.deleteSubscription).toHaveBeenCalledWith('sub-1');
    });

    it('should throw ValidationError for invalid token format', async () => {
      const service = createService();

      await expect(service.unsubscribe('short')).rejects.toThrow(ValidationError);
      expect(mockSubscriptionRepo.findByUnsubscribeToken).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError for unknown token', async () => {
      const service = createService();

      mockSubscriptionRepo.findByUnsubscribeToken.mockResolvedValue(null);

      await expect(service.unsubscribe(VALID_TOKEN_2)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getSubscriptions', () => {
    it('should return subscriptions for a valid email', async () => {
      const service = createService();

      // findAllByEmail now returns SubscriptionWithRepo[] (raw rows)
      const mockRows = [
        {
          id: 'sub-1',
          email: 'test@example.com',
          repoId: 'repo-1',
          confirmed: true,
          confirmToken: null,
          unsubscribeToken: 'unsub123',
          createdAt: new Date(),
          updatedAt: new Date(),
          repo: {
            id: 'repo-1',
            owner: 'golang',
            name: 'go',
            lastSeenTag: 'v1.22.0',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];
      mockSubscriptionRepo.findAllByEmail.mockResolvedValue(mockRows as never);

      const result = await service.getSubscriptions('test@example.com');

      expect(result).toEqual([
        { email: 'test@example.com', repo: 'golang/go', confirmed: true, last_seen_tag: 'v1.22.0' },
      ]);
      expect(mockSubscriptionRepo.findAllByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should throw ValidationError for invalid email', async () => {
      const service = createService();

      await expect(service.getSubscriptions('not-an-email')).rejects.toThrow(ValidationError);
    });
  });
});

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: () => logger,
} as never;

describe('SubscriptionService.subscribe (saga)', () => {
  it('creates subscription and starts the saga in one transaction, no event published', async () => {
    const created = {
      id: 'sub1',
      email: 'a@b.c',
      repoId: 'r1',
      confirmToken: 'ctok',
      unsubscribeToken: 'utok',
    };
    const subRepo = {
      findByEmailAndRepo: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(created),
    };
    const repoRepo = {
      findOrCreate: jest.fn().mockResolvedValue({ id: 'r1', owner: 'x', name: 'y' }),
    };
    const github = { verifyRepo: jest.fn().mockResolvedValue(undefined) };
    const validator = {
      assertEmail: jest.fn(),
      parseSlug: jest.fn().mockReturnValue({ owner: 'x', name: 'y' }),
    };
    const saga = { start: jest.fn().mockResolvedValue('s1') };
    // prisma.$transaction(cb) runs cb with a tx client (here, a sentinel).
    const tx = { __tx: true };
    const prisma = { $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

    const service = new SubscriptionService(
      subRepo as never,
      repoRepo as never,
      github as never,
      validator as never,
      prisma as never,
      saga as never,
      logger,
    );

    await service.subscribe('a@b.c', 'x/y');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(subRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.c', repoId: 'r1' }),
      tx,
    );
    expect(saga.start).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub1', email: 'a@b.c', repoSlug: 'x/y' }),
      tx,
    );
  });
});
