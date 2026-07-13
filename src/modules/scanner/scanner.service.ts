import type { IGitHubService } from '@/modules/github';
import type { IRepoRepository, ISubscriptionRepository } from '@/modules/subscriptions';
import { RateLimitError } from '@/shared/errors/app-error';
import type { IEventBus } from '@/shared/events';
import { NEW_RELEASE_DETECTED, type NewReleaseDetectedEvent } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import type { IMetricsCollector } from '@/shared/metrics';
import { METRIC_NAMES } from '@/shared/metrics';

export interface ScanResult {
  scanned: number;
  newReleases: number;
}

type RepoScanResult =
  | { status: 'no-releases' }
  | { status: 'no-change' }
  | { status: 'new-release'; newTag: string };

export class ScannerService {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly repoRepo: IRepoRepository,
    private readonly githubService: IGitHubService,
    private readonly events: IEventBus,
    private readonly metrics: IMetricsCollector,
    private readonly logger: ILogger,
  ) {}

  async scanAllRepos(): Promise<ScanResult> {
    this.metrics.incrementCounter(METRIC_NAMES.SCAN_RELEASES_TOTAL);
    this.logger.info('Starting release scan...');

    const repos = await this.repoRepo.findDistinctConfirmed();
    this.logger.info({ repoCount: repos.length }, 'Scanning repos for new releases');

    let scanned = 0;
    let newReleases = 0;

    for (const repo of repos) {
      const repoSlug = `${repo.owner}/${repo.name}`;
      try {
        const result = await this.scanSingleRepo(repo);
        if (result.status === 'new-release') {
          newReleases++;
          this.metrics.incrementCounter(METRIC_NAMES.NEW_RELEASES_DETECTED_TOTAL);
        }
        scanned++;
      } catch (err) {
        if (err instanceof RateLimitError) {
          this.logger.warn(
            { retryAfter: err.retryAfter, scanned, remaining: repos.length - scanned },
            'GitHub API rate limit hit during scan, stopping',
          );
          break;
        }
        this.logger.error({ err, repo: repoSlug }, 'Error scanning repo');
        scanned++;
      }
    }

    this.logger.info({ scanned, newReleases }, 'Release scan completed');
    return { scanned, newReleases };
  }

  private async scanSingleRepo(repo: {
    id: string;
    owner: string;
    name: string;
    lastSeenTag: string | null;
  }): Promise<RepoScanResult> {
    const repoSlug = `${repo.owner}/${repo.name}`;
    const release = await this.githubService.getLatestRelease(repo.owner, repo.name);

    if (!release) {
      this.logger.debug({ repo: repoSlug }, 'No releases found for repo');
      return { status: 'no-releases' };
    }

    if (release.tag_name === repo.lastSeenTag) {
      this.logger.debug({ repo: repoSlug, tag: release.tag_name }, 'No new release');
      return { status: 'no-change' };
    }

    this.logger.info(
      { repo: repoSlug, tag: release.tag_name, previous: repo.lastSeenTag },
      'New release detected',
    );
    const subscriptions = await this.subscriptionRepo.findAllConfirmedByRepoId(repo.id);

    await this.events.publish<NewReleaseDetectedEvent>({
      type: NEW_RELEASE_DETECTED,
      repoSlug,
      release: {
        tagName: release.tag_name,
        name: release.name,
        htmlUrl: release.html_url,
        publishedAt: release.published_at,
      },
      subscribers: subscriptions.map((s) => ({
        email: s.email,
        unsubscribeToken: s.unsubscribeToken,
      })),
      occurredAt: new Date().toISOString(),
    });

    await this.repoRepo.updateLastSeenTag(repo.id, release.tag_name);

    return { status: 'new-release', newTag: release.tag_name };
  }
}
