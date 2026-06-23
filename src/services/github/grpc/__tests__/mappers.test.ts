import type { GitHubRelease, GitHubRepo } from '@/modules/github';
import { releaseToProto, repoToProto } from '../mappers';

const repo: GitHubRepo = {
  id: 1,
  full_name: 'a/b',
  name: 'b',
  owner: { login: 'a' },
  description: null,
  html_url: 'https://x',
  private: false,
};

describe('repoToProto', () => {
  it('flattens owner and coerces null description to empty string', () => {
    const p = repoToProto(repo);
    expect(p.ownerLogin).toBe('a');
    expect(p.description).toBe('');
    expect(p.fullName).toBe('a/b');
  });
});

describe('releaseToProto', () => {
  it('maps null release to found=false', () => {
    expect(releaseToProto(null)).toEqual({ found: false });
  });
  it('maps a release to found=true with coerced nulls', () => {
    const rel: GitHubRelease = {
      id: 9,
      tag_name: 'v1',
      name: null,
      body: null,
      html_url: 'https://r',
      published_at: null,
      draft: false,
      prerelease: false,
    };
    const out = releaseToProto(rel);
    expect(out.found).toBe(true);
    expect(out.release?.tagName).toBe('v1');
    expect(out.release?.name).toBe('');
    expect(out.release?.publishedAt).toBe('');
  });
});
