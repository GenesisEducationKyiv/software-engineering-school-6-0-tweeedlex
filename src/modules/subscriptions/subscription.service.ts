import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { logger } from '../../config/logger';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/app-error';
import { generateToken } from '../../shared/utils/token';
import {
  isValidEmail,
  isValidRepoFormat,
  isValidToken,
  parseRepo,
} from '../../shared/utils/validation';
import type { GitHubService } from '../github/github.service';
import { type ConfirmationJobData, NOTIFICATION_QUEUE } from '../notifications/notification.worker';
import type { SubscriptionRepository } from './subscription.repository';
import type { SubscriptionResponse } from './subscription.types';

export class SubscriptionService {
  private notificationQueue: Queue | null = null;

  constructor(
    private readonly repo: SubscriptionRepository,
    private readonly githubService: GitHubService,
    private readonly bullConnection: IORedis,
  ) {}

  private getNotificationQueue(): Queue {
    if (!this.notificationQueue) {
      this.notificationQueue = new Queue(NOTIFICATION_QUEUE, {
        connection: this.bullConnection,
      });
    }
    return this.notificationQueue;
  }

  async subscribe(email: string, repoSlug: string): Promise<void> {
    // Validate format
    if (!isValidRepoFormat(repoSlug)) {
      throw new ValidationError('Invalid repository format. Expected: owner/repo');
    }

    const { owner, name } = parseRepo(repoSlug);

    // Verify repository exists on GitHub
    await this.githubService.verifyRepo(owner, name);

    // Find or create repo record
    const repoRecord = await this.repo.findOrCreateRepo(owner, name);

    // Check for duplicate
    const existing = await this.repo.findByEmailAndRepo(email, repoRecord.id);
    if (existing) {
      throw new ConflictError(`Email ${email} is already subscribed to ${repoSlug}`);
    }

    // Create subscription with tokens
    const confirmToken = generateToken();
    const unsubscribeToken = generateToken();

    await this.repo.create({
      email,
      repoId: repoRecord.id,
      confirmToken,
      unsubscribeToken,
    });

    // Enqueue confirmation email
    const jobData: ConfirmationJobData = {
      type: 'confirmation',
      email,
      confirmToken,
      repo: repoSlug,
    };

    await this.getNotificationQueue().add('send-confirmation', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    logger.info({ email, repo: repoSlug }, 'Subscription created, confirmation email queued');
  }

  async confirm(token: string): Promise<void> {
    if (!isValidToken(token)) {
      throw new ValidationError('Invalid token format');
    }

    const subscription = await this.repo.findByConfirmToken(token);

    if (!subscription) {
      throw new NotFoundError('Confirmation token not found or already used');
    }

    await this.repo.confirmSubscription(subscription.id);
    logger.info({ email: subscription.email }, 'Subscription confirmed');
  }

  async unsubscribe(token: string): Promise<void> {
    if (!isValidToken(token)) {
      throw new ValidationError('Invalid token format');
    }

    const subscription = await this.repo.findByUnsubscribeToken(token);

    if (!subscription) {
      throw new NotFoundError('Unsubscribe token not found');
    }

    await this.repo.deleteSubscription(subscription.id);
    logger.info({ email: subscription.email }, 'Subscription removed');
  }

  async getSubscriptions(email: string): Promise<SubscriptionResponse[]> {
    if (!isValidEmail(email)) {
      throw new ValidationError('Invalid email address');
    }

    return this.repo.findAllByEmail(email);
  }
}
