import type { ILogger } from '@/shared/logger';
import type { RedisClient } from '@/infrastructure/redis/redis-factory';
import type { GitHubRelease, GitHubRepo } from './github.types';

type CacheKind = 'repo' | 'release';

export class GitHubCache {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number,
    private readonly logger: ILogger,
  ) {}

  async getRepo(owner: string, name: string): Promise<GitHubRepo | null> {
    const result = await this.getJson<GitHubRepo>(this.key('repo', owner, name));
    if (result !== undefined) this.logger.debug({ owner, name }, 'GitHub repo cache hit');
    return result ?? null;
  }

  async setRepo(owner: string, name: string, repo: GitHubRepo): Promise<void> {
    await this.setJson(this.key('repo', owner, name), repo);
    this.logger.debug({ owner, name }, 'GitHub repo cached');
  }

  async getRelease(owner: string, name: string): Promise<GitHubRelease | null | undefined> {
    const cached = await this.redis.get(this.key('release', owner, name)).catch(() => undefined);
    if (cached === undefined || cached === null) return undefined;
    this.logger.debug({ owner, name }, 'GitHub release cache hit');
    return JSON.parse(cached) as GitHubRelease | null;
  }

  async setRelease(owner: string, name: string, release: GitHubRelease | null): Promise<void> {
    await this.setJson(this.key('release', owner, name), release);
    this.logger.debug({ owner, name }, 'GitHub release cached');
  }

  private key(kind: CacheKind, owner: string, name: string): string {
    return `github:${kind}:${owner}/${name}`;
  }

  private async getJson<T>(key: string): Promise<T | undefined> {
    try {
      const cached = await this.redis.get(key);
      if (cached === null) return undefined;
      return JSON.parse(cached) as T;
    } catch {
      this.logger.warn({ key }, 'Failed to read from GitHub cache');
      return undefined;
    }
  }

  private async setJson(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), { EX: this.ttlSeconds });
    } catch {
      this.logger.warn({ key }, 'Failed to write to GitHub cache');
    }
  }
}
