import type { GetLatestReleaseResponse, VerifyRepoResponse } from '@/generated/proto/github';
import type { GitHubRelease, GitHubRepo } from '@/modules/github';

export function repoToProto(repo: GitHubRepo): VerifyRepoResponse {
  return {
    id: repo.id,
    fullName: repo.full_name,
    name: repo.name,
    ownerLogin: repo.owner.login,
    description: repo.description ?? '',
    htmlUrl: repo.html_url,
    private: repo.private,
  };
}

export function releaseToProto(release: GitHubRelease | null): GetLatestReleaseResponse {
  if (release === null) return { found: false };
  return {
    found: true,
    release: {
      id: release.id,
      tagName: release.tag_name,
      name: release.name ?? '',
      body: release.body ?? '',
      htmlUrl: release.html_url,
      publishedAt: release.published_at ?? '',
      draft: release.draft,
      prerelease: release.prerelease,
    },
  };
}
