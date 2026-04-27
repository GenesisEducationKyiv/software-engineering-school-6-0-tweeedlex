import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { logger } from '../../config/logger';
import { RateLimitError } from '../../shared/errors/app-error';
import type { GitHubService } from '../github/github.service';
import {
  NOTIFICATION_QUEUE,
  type ReleaseNotificationJobData,
} from '../notifications/notification.worker';
import type { SubscriptionRepository } from '../subscriptions/subscription.repository';

export class ScannerService {
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

  async scanAllRepos(): Promise<void> {
    logger.info('Starting release scan...');

    const repos = await this.repo.findDistinctConfirmedRepos();
    logger.info({ repoCount: repos.length }, 'Scanning repos for new releases');

    let scanned = 0;
    let newReleases = 0;
    let notificationsQueued = 0;

    for (const repo of repos) {
      const repoSlug = `${repo.owner}/${repo.name}`;

      try {
        const release = await this.githubService.getLatestRelease(repo.owner, repo.name);

        if (!release) {
          logger.debug({ repo: repoSlug }, 'No releases found for repo');
          scanned++;
          continue;
        }

        if (release.tag_name !== repo.lastSeenTag) {
          logger.info(
            { repo: repoSlug, tag: release.tag_name, previous: repo.lastSeenTag },
            'New release detected',
          );

          // Update last seen tag
          await this.repo.updateRepoLastSeenTag(repo.id, release.tag_name);
          newReleases++;

          // Get all confirmed subscribers for this repo
          const subscriptions = await this.repo.findAllConfirmedByRepoId(repo.id);

          // Enqueue notification for each subscriber
          for (const sub of subscriptions) {
            const jobData: ReleaseNotificationJobData = {
              type: 'release-notification',
              email: sub.email,
              unsubscribeToken: sub.unsubscribeToken,
              repo: repoSlug,
              release,
            };

            await this.getNotificationQueue().add('send-release-notification', jobData, {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            });

            notificationsQueued++;
          }
        } else {
          logger.debug({ repo: repoSlug, tag: release.tag_name }, 'No new release');
        }

        scanned++;
      } catch (err) {
        if (err instanceof RateLimitError) {
          logger.warn(
            { retryAfter: err.retryAfter, scanned, remaining: repos.length - scanned },
            'GitHub API rate limit hit during scan, stopping',
          );
          break;
        }

        logger.error({ err, repo: repoSlug }, 'Error scanning repo');
        scanned++;
      }
    }

    logger.info({ scanned, newReleases, notificationsQueued }, 'Release scan completed');
  }
}
