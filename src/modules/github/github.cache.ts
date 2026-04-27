import { logger } from '../../config/logger';
import type { RedisClient } from '../../infrastructure/redis/redis-client';
import type { GitHubRelease, GitHubRepo } from './github.types';

export class GitHubCache {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number,
  ) {}

  private repoKey(owner: string, name: string): string {
    return `github:repo:${owner}/${name}`;
  }

  private releaseKey(owner: string, name: string): string {
    return `github:release:${owner}/${name}`;
  }

  async getRepo(owner: string, name: string): Promise<GitHubRepo | null> {
    try {
      const cached = await this.redis.get(this.repoKey(owner, name));
      if (!cached) {
        return null;
      }
      logger.debug({ owner, name }, 'GitHub repo cache hit');
      return JSON.parse(cached) as GitHubRepo;
    } catch (err) {
      logger.warn({ err }, 'Failed to read from GitHub cache');
      return null;
    }
  }

  async setRepo(owner: string, name: string, repo: GitHubRepo): Promise<void> {
    try {
      await this.redis.set(this.repoKey(owner, name), JSON.stringify(repo), {
        EX: this.ttlSeconds,
      });
      logger.debug({ owner, name }, 'GitHub repo cached');
    } catch (err) {
      logger.warn({ err }, 'Failed to write to GitHub cache');
    }
  }

  async getRelease(owner: string, name: string): Promise<GitHubRelease | null | undefined> {
    try {
      const cached = await this.redis.get(this.releaseKey(owner, name));
      if (cached === null) {
        return undefined;
      }
      logger.debug({ owner, name }, 'GitHub release cache hit');
      // stored as JSON string "null" when repo has no releases
      return JSON.parse(cached) as GitHubRelease | null;
    } catch (err) {
      logger.warn({ err }, 'Failed to read from GitHub release cache');
      return undefined;
    }
  }

  async setRelease(owner: string, name: string, release: GitHubRelease | null): Promise<void> {
    try {
      await this.redis.set(this.releaseKey(owner, name), JSON.stringify(release), {
        EX: this.ttlSeconds,
      });
      logger.debug({ owner, name }, 'GitHub release cached');
    } catch (err) {
      logger.warn({ err }, 'Failed to write to GitHub release cache');
    }
  }
}
