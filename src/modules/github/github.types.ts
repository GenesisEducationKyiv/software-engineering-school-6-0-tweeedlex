export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: {
    login: string;
  };
  description: string | null;
  html_url: string;
  private: boolean;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

export interface GitHubRateLimitHeaders {
  remaining: number;
  reset: number;
  limit: number;
}

export interface IGitHubService {
  verifyRepo(owner: string, name: string): Promise<GitHubRepo>;
  getLatestRelease(
    owner: string,
    name: string,
    bypassCache?: boolean,
  ): Promise<GitHubRelease | null>;
}
