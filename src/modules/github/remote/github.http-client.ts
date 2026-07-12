import type { IGitHubService } from '../github.module';
import type { GitHubRelease, GitHubRepo } from '../github.types';
import { AppError, NotFoundError, RateLimitError } from '@/shared/errors/app-error';
import type { ILogger } from '@/shared/logger';

export interface GitHubHttpClientConfig {
  baseUrl: string;
  apiKey: string;
  logger: ILogger;
}

export class GitHubHttpClient implements IGitHubService {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly logger: ILogger;

  constructor(config: GitHubHttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.headers = { 'x-api-key': config.apiKey, 'content-type': 'application/json' };
    this.logger = config.logger;
  }

  async verifyRepo(owner: string, name: string): Promise<GitHubRepo> {
    const res = await fetch(`${this.baseUrl}/internal/repos/${owner}/${name}`, {
      headers: this.headers,
    });
    if (!res.ok) await this.throwFromResponse(res);
    return res.json() as Promise<GitHubRepo>;
  }

  async getLatestRelease(owner: string, name: string, bypassCache = false): Promise<GitHubRelease | null> {
    const url = `${this.baseUrl}/internal/repos/${owner}/${name}/latest-release${bypassCache ? '?bypassCache=true' : ''}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) await this.throwFromResponse(res);
    const body = await res.json() as { found: boolean; release: GitHubRelease | null };
    return body.found ? body.release : null;
  }

  private async throwFromResponse(res: Response): Promise<never> {
    let message = res.statusText;
    try {
      const body = await res.json() as { message?: string };
      if (body.message) message = body.message;
    } catch (_e) {}
    if (res.status === 404) throw new NotFoundError(message);
    if (res.status === 429 || res.status === 403) throw new RateLimitError(0);
    throw new AppError(message, res.status);
  }
}
