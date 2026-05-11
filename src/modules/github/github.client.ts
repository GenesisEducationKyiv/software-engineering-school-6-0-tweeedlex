import { NotFoundError, RateLimitError } from '@/shared/errors/app-error';
import type { ILogger } from '@/shared/logger';
import type { IMetricsCollector } from '@/shared/metrics';
import { METRIC_NAMES } from '@/shared/metrics';
import type { GitHubRateLimitHeaders, GitHubRelease, GitHubRepo } from './github.types';

const GITHUB_API_BASE = 'https://api.github.com';

export class GitHubClient {
  private readonly headers: Record<string, string>;

  constructor(
    githubToken: string | undefined,
    private readonly logger: ILogger,
    private readonly metrics: IMetricsCollector,
  ) {
    this.headers = {
      'User-Agent': 'github-release-notification-api/1.0.0',
      Accept: 'application/vnd.github.v3+json',
    };
    if (githubToken) this.headers.Authorization = `token ${githubToken}`;
  }

  async getRepo(owner: string, name: string): Promise<GitHubRepo> {
    return this.fetchGitHub<GitHubRepo>(`/repos/${owner}/${name}`, {
      treat404As: 'throw',
      notFoundMessage: `Repository ${owner}/${name} not found on GitHub`,
    }) as Promise<GitHubRepo>;
  }

  async getLatestRelease(owner: string, name: string): Promise<GitHubRelease | null> {
    return this.fetchGitHub<GitHubRelease>(`/repos/${owner}/${name}/releases/latest`, {
      treat404As: 'null',
    });
  }

  private async fetchGitHub<T>(
    path: string,
    opts: { treat404As: 'throw' | 'null'; notFoundMessage?: string },
  ): Promise<T | null> {
    const response = await fetch(GITHUB_API_BASE + path, { headers: this.headers });

    this.metrics.incrementCounter(METRIC_NAMES.GITHUB_API_CALLS_TOTAL, {
      endpoint: path,
      status: String(response.status),
    });

    if (response.status === 404) {
      if (opts.treat404As === 'null') return null;
      throw new NotFoundError(opts.notFoundMessage ?? 'Not found');
    }

    if (
      response.status === 429 ||
      (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0')
    ) {
      throw new RateLimitError(this.extractRetryAfter(response.headers));
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    this.handleRateLimit(response.headers);
    return response.json() as Promise<T>;
  }

  private parseRateLimitHeaders(headers: Headers): GitHubRateLimitHeaders {
    return {
      remaining: Number(headers.get('X-RateLimit-Remaining') ?? '1'),
      reset: Number(headers.get('X-RateLimit-Reset') ?? '0'),
      limit: Number(headers.get('X-RateLimit-Limit') ?? '60'),
    };
  }

  private handleRateLimit(headers: Headers): void {
    const rateLimit = this.parseRateLimitHeaders(headers);
    this.logger.debug({ rateLimit }, 'GitHub API rate limit status');
    if (rateLimit.remaining < 5) {
      const retryAfter = Math.max(0, rateLimit.reset - Math.floor(Date.now() / 1000));
      this.logger.warn({ rateLimit, retryAfter }, 'GitHub API rate limit nearly exhausted');
      throw new RateLimitError(retryAfter);
    }
  }

  private extractRetryAfter(headers: Headers): number {
    return Number(
      headers.get('Retry-After') ??
        Math.max(0, Number(headers.get('X-RateLimit-Reset') ?? '0') - Math.floor(Date.now() / 1000)),
    ) || 3600;
  }
}
