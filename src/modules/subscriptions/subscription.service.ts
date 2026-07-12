import type { IGitHubService } from '@/modules/github';
import type { IConfirmationSagaStarter } from '@/modules/saga';
import { ConflictError, NotFoundError } from '@/shared/errors/app-error';
import type { ILogger } from '@/shared/logger';
import { generateToken } from '@/shared/utils/token';
import type { PrismaClient, Repo } from '@prisma/client';
import { toSubscriptionResponses } from './subscription.mapper';
import type { IRepoRepository, ISubscriptionRepository } from './subscription.repository.interface';
import type { SubscriptionResponse } from './subscription.types';
import type { SubscriptionValidator } from './subscription.validator';

export class SubscriptionService {
  constructor(
    private readonly repo: ISubscriptionRepository,
    private readonly repoRepo: IRepoRepository,
    private readonly githubService: IGitHubService,
    private readonly validator: SubscriptionValidator,
    private readonly prisma: PrismaClient,
    private readonly saga: IConfirmationSagaStarter,
    private readonly logger: ILogger,
  ) {}

  async subscribe(email: string, repoSlug: string): Promise<void> {
    this.validator.assertEmail(email);
    const { owner, name } = this.validator.parseSlug(repoSlug);
    const repoRecord = await this.ensureRepoExists(owner, name);
    await this.assertNotDuplicate(email, repoRecord.id);

    const confirmToken = generateToken();
    const unsubscribeToken = generateToken();

    await this.prisma.$transaction(async (tx) => {
      const subscription = await this.repo.create(
        { email, repoId: repoRecord.id, confirmToken, unsubscribeToken },
        tx,
      );
      await this.saga.start(
        { subscriptionId: subscription.id, email, repoSlug, confirmToken },
        tx,
      );
    });

    this.logger.info({ email, repo: repoSlug }, 'Subscription created, confirmation saga started');
  }

  async confirm(token: string): Promise<void> {
    this.validator.assertToken(token);
    const subscription = await this.repo.findByConfirmToken(token);
    if (!subscription) throw new NotFoundError('Confirmation token not found or already used');
    await this.repo.confirmSubscription(subscription.id);
    this.logger.info({ email: subscription.email }, 'Subscription confirmed');
  }

  async unsubscribe(token: string): Promise<void> {
    this.validator.assertToken(token);
    const subscription = await this.repo.findByUnsubscribeToken(token);
    if (!subscription) throw new NotFoundError('Unsubscribe token not found');
    await this.repo.deleteSubscription(subscription.id);
    this.logger.info({ email: subscription.email }, 'Subscription removed');
  }

  async getSubscriptions(email: string): Promise<SubscriptionResponse[]> {
    this.validator.assertEmail(email);
    const rows = await this.repo.findAllByEmail(email);
    return toSubscriptionResponses(rows);
  }

  private async ensureRepoExists(owner: string, name: string): Promise<Repo> {
    await this.githubService.verifyRepo(owner, name);
    return this.repoRepo.findOrCreate(owner, name);
  }

  private async assertNotDuplicate(email: string, repoId: string): Promise<void> {
    const existing = await this.repo.findByEmailAndRepo(email, repoId);
    if (existing) throw new ConflictError(`Email ${email} is already subscribed to this repo`);
  }
}
