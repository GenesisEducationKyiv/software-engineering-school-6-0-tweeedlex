const REPO_REGEX = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

function parseGitHubUrl(repo: string): { owner: string; name: string } | null {
  try {
    const url = new URL(repo);
    if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname)) {
      return null;
    }
    const [owner, name] = url.pathname.split('/').filter(Boolean);
    if (!owner || !name) return null;
    return { owner, name };
  } catch {
    return null;
  }
}

export function isValidRepoFormat(repo: string): boolean {
  if (REPO_REGEX.test(repo)) return true;
  const parsed = parseGitHubUrl(repo);
  return parsed !== null && REPO_REGEX.test(`${parsed.owner}/${parsed.name}`);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function isValidToken(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

export function parseRepo(repo: string): { owner: string; name: string } {
  const githubUrl = parseGitHubUrl(repo);
  if (githubUrl) return githubUrl;
  const parts = repo.split('/');
  return { owner: parts[0], name: parts[1] };
}
