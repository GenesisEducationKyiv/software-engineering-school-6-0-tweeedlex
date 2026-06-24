import { PrismaClient } from '@prisma/client';

export const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
export const MOCK_SERVICE_URL = process.env.MOCK_SERVICE_URL || 'http://localhost:4000';
export const API_KEY = process.env.API_KEY || 'test-api-key';
export const VALID_MISSING_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

export const prisma = new PrismaClient();

export async function resetState(): Promise<void> {
  await prisma.subscription.deleteMany();
  await prisma.repo.deleteMany();
  await fetch(`${MOCK_SERVICE_URL}/emails/reset`, { method: 'POST' });
  await fetch(`${MOCK_SERVICE_URL}/github/__admin/reset`, { method: 'POST' });
}

export async function postJson(path: string, body: unknown, apiKey = API_KEY): Promise<Response> {
  return fetch(`${APP_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
}

export async function subscribe(email: string, repo: string): Promise<Response> {
  return postJson('/api/subscribe', { email, repo });
}

function repoFilter(repo: string) {
  const slug = repo.replace(/^https:\/\/github\.com\//, '');
  const [owner, name] = slug.split('/');
  return { repo: { owner, name } };
}

// `repo` disambiguates when an email has several subscriptions, so the wrong
// one is never picked up (which would make confirm/unsubscribe tests flaky).
export async function getConfirmToken(email: string, repo: string): Promise<string> {
  const subscription = await prisma.subscription.findFirstOrThrow({
    where: { email, ...repoFilter(repo) },
  });
  if (!subscription.confirmToken) throw new Error(`No confirmation token for ${email} / ${repo}`);
  return subscription.confirmToken;
}

export async function getUnsubscribeToken(email: string, repo: string): Promise<string> {
  const subscription = await prisma.subscription.findFirstOrThrow({
    where: { email, ...repoFilter(repo) },
  });
  return subscription.unsubscribeToken;
}

export interface CapturedEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export async function waitForEmails(count: number): Promise<CapturedEmail[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const emailsResponse = await fetch(`${MOCK_SERVICE_URL}/emails`);
    const { emails } = (await emailsResponse.json()) as { emails: CapturedEmail[] };
    if (emails.length >= count) return emails;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Expected at least ${count} captured emails`);
}

// Asserts the captured confirmation email is addressed and linked correctly,
// instead of only checking that *some* email was sent.
export async function expectConfirmationEmail(
  email: string,
  repo: string,
  confirmToken: string,
): Promise<void> {
  const [captured] = await waitForEmails(1);
  expect(captured.to).toBe(email);
  expect(captured.subject).toBe(`Confirm subscription to ${repo} releases`);
  expect(captured.html).toContain(`/confirm.html?token=${confirmToken}`);
}
