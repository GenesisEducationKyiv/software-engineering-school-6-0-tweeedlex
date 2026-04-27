import type { GitHubCache } from './github.cache';
import type { GitHubClient } from './github.client';
import type { GitHubRelease, GitHubRepo } from './github.types';

export class GitHubService {
  constructor(
    private readonly client: GitHubClient,
    private readonly cache: GitHubCache,
  ) {}

  async verifyRepo(owner: string, name: string): Promise<GitHubRepo> {
    // Check cache first
    const cached = await this.cache.getRepo(owner, name);
    if (cached) {
      return cached;
    }

    // Call GitHub API (throws NotFoundError if not found)
    const repo = await this.client.getRepo(owner, name);

    // Cache the result
    await this.cache.setRepo(owner, name, repo);

    return repo;
  }

  async getLatestRelease(
    owner: string,
    name: string,
    bypassCache = false,
  ): Promise<GitHubRelease | null> {
    if (!bypassCache) {
      const cached = await this.cache.getRelease(owner, name);
      if (cached !== undefined) {
        return cached;
      }
    }

    const release = await this.client.getLatestRelease(owner, name);

    if (!bypassCache) {
      await this.cache.setRelease(owner, name, release);
    }

    return release;
  }
}
