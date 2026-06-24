import { PrismaClient } from '@prisma/client';

export const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
export const MOCK_SERVICE_URL = process.env.MOCK_SERVICE_URL || 'http://localhost:4000';
export const API_KEY = process.env.API_KEY || 'test-api-key';
export const VALID_MISSING_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

export const prisma = new PrismaClient();

// Tests do not share data: every test allocates its own email/repo, so suites
// can run in parallel without dropping the database or flushing Redis between
// them. The worker id keeps ids unique across jest workers, the counter unique
// within a worker.
const workerId = process.env.JEST_WORKER_ID ?? '0';
let seq = 0;

function nextId(): string {
  seq += 1;
  return `${workerId}-${seq}`;
}

export function uniqueEmail(label = 'user'): string {
  return `${label}-${nextId()}@example.com`;
}

export function uniqueRepo(): string {
  const id = nextId().replace('-', '');
  return `acme/repo-${id}`;
}

// Disconnects Prisma once the suite is done. No per-test reset: isolation comes
// from unique data, not from clearing shared state.
export function useIsolatedState(): void {
  afterAll(async () => {
    await prisma.$disconnect();
  });
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

// Filters by recipient so a parallel test's emails are never mistaken for
// this one's. Returns only the emails addressed to `recipient`.
export async function waitForEmailsTo(recipient: string, count: number): Promise<CapturedEmail[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const emailsResponse = await fetch(`${MOCK_SERVICE_URL}/emails`);
    const { emails } = (await emailsResponse.json()) as { emails: CapturedEmail[] };
    const mine = emails.filter((e) => e.to === recipient);
    if (mine.length >= count) return mine;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Expected at least ${count} captured emails for ${recipient}`);
}

// Asserts the captured confirmation email is addressed and linked correctly,
// instead of only checking that *some* email was sent.
export async function expectConfirmationEmail(
  email: string,
  repo: string,
  confirmToken: string,
): Promise<void> {
  const [captured] = await waitForEmailsTo(email, 1);
  expect(captured.subject).toBe(`Confirm subscription to ${repo} releases`);
  expect(captured.html).toContain(`/confirm.html?token=${confirmToken}`);
}
