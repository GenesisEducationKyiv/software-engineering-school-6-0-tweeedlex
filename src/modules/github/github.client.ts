import { logger } from '../../config/logger';
import { NotFoundError, RateLimitError } from '../../shared/errors/app-error';
import type { GitHubRateLimitHeaders, GitHubRelease, GitHubRepo } from './github.types';

const GITHUB_API_BASE = 'https://api.github.com';

export class GitHubClient {
  private readonly headers: Record<string, string>;

  constructor(githubToken?: string) {
    this.headers = {
      'User-Agent': 'github-release-notification-api/1.0.0',
      Accept: 'application/vnd.github.v3+json',
    };

    if (githubToken) {
      this.headers.Authorization = `token ${githubToken}`;
    }
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
    logger.debug({ rateLimit }, 'GitHub API rate limit status');

    if (rateLimit.remaining < 5) {
      const retryAfter = Math.max(0, rateLimit.reset - Math.floor(Date.now() / 1000));
      logger.warn({ rateLimit, retryAfter }, 'GitHub API rate limit nearly exhausted');
      throw new RateLimitError(retryAfter);
    }
  }

  async getRepo(owner: string, name: string): Promise<GitHubRepo> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${name}`;
    const response = await fetch(url, { headers: this.headers });

    if (response.status === 404) {
      throw new NotFoundError(`Repository ${owner}/${name} not found on GitHub`);
    }

    if (
      response.status === 429 ||
      (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0')
    ) {
      const retryAfter = Number(
        response.headers.get('Retry-After') ??
          Math.max(
            0,
            Number(response.headers.get('X-RateLimit-Reset') ?? '0') -
              Math.floor(Date.now() / 1000),
          ),
      );
      throw new RateLimitError(retryAfter || 3600);
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    this.handleRateLimit(response.headers);

    return response.json() as Promise<GitHubRepo>;
  }

  async getLatestRelease(owner: string, name: string): Promise<GitHubRelease | null> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${name}/releases/latest`;
    const response = await fetch(url, { headers: this.headers });

    if (response.status === 404) {
      // No releases for this repo
      return null;
    }

    if (
      response.status === 429 ||
      (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0')
    ) {
      const retryAfter = Number(
        response.headers.get('Retry-After') ??
          Math.max(
            0,
            Number(response.headers.get('X-RateLimit-Reset') ?? '0') -
              Math.floor(Date.now() / 1000),
          ),
      );
      throw new RateLimitError(retryAfter || 3600);
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    this.handleRateLimit(response.headers);

    return response.json() as Promise<GitHubRelease>;
  }
}
