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

export async function getConfirmToken(email: string): Promise<string> {
  const subscription = await prisma.subscription.findFirstOrThrow({ where: { email } });
  if (!subscription.confirmToken) throw new Error(`No confirmation token for ${email}`);
  return subscription.confirmToken;
}

export async function getUnsubscribeToken(email: string): Promise<string> {
  const subscription = await prisma.subscription.findFirstOrThrow({ where: { email } });
  return subscription.unsubscribeToken;
}

export async function waitForEmailCount(count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const emailsResponse = await fetch(`${MOCK_SERVICE_URL}/emails`);
    const { emails } = (await emailsResponse.json()) as { emails: unknown[] };
    if (emails.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Expected at least ${count} captured emails`);
}
