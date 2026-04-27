const REPO_REGEX = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export function isValidRepoFormat(repo: string): boolean {
  return REPO_REGEX.test(repo);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function isValidToken(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

export function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split('/');
  return { owner: parts[0], name: parts[1] };
}
