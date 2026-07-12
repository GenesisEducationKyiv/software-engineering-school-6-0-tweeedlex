import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const MOCK_SERVICE_URL = process.env.MOCK_SERVICE_URL || 'http://localhost:4000';
const API_KEY = process.env.API_KEY || 'test-api-key';
const prisma = new PrismaClient();

async function resetState() {
  await prisma.subscription.deleteMany();
  await prisma.repo.deleteMany();
  await fetch(`${MOCK_SERVICE_URL}/emails/reset`, { method: 'POST' });
}

interface CapturedEmail {
  to: string;
  subject: string;
  html: string;
}

async function waitForEmailTo(email: string): Promise<CapturedEmail> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${MOCK_SERVICE_URL}/emails`);
    const { emails } = (await response.json()) as { emails: CapturedEmail[] };
    const match = emails.find((e) => e.to === email);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No confirmation email captured for ${email}`);
}

function extractConfirmUrl(html: string): string {
  const match = html.match(/\/confirm\.html\?token=[A-Za-z0-9_-]+/);
  if (!match) throw new Error('No confirmation link found in email');
  return match[0];
}

// Drives the real user confirmation flow: subscribe via the API, read the
// confirmation link from the captured email, then open confirm.html in the
// browser. This catches breakage in the email link or the confirm page that a
// direct DB/API confirm would silently miss.
async function subscribeAndConfirm(
  page: import('@playwright/test').Page,
  email: string,
  repo: string,
) {
  const subscribeResponse = await fetch(`${APP_BASE_URL}/api/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({ email, repo }),
  });
  expect(subscribeResponse.status).toBe(200);

  const captured = await waitForEmailTo(email);
  expect(captured.subject).toBe(`Confirm subscription to ${repo} releases`);

  await page.goto(extractConfirmUrl(captured.html));
  await expect(page.getByRole('heading', { name: 'Subscription confirmed!' })).toBeVisible();

  const subscription = await prisma.subscription.findFirstOrThrow({ where: { email } });
  expect(subscription.confirmed).toBe(true);
}

test.beforeEach(async () => {
  await resetState();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('renders the main page controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'REST' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'gRPC' })).toBeVisible();
  await expect(page.locator('#globalApiKey')).toBeVisible();
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#repo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Subscribe to releases' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check subscriptions' })).toBeVisible();
});

test('shows validation feedback when API key is missing', async ({ page }) => {
  await page.goto('/');

  await page.locator('#email').fill('test@example.com');
  await page.locator('#repo').fill('golang/go');
  await page.getByRole('button', { name: 'Subscribe to releases' }).click();

  await expect(page.locator('#message')).toHaveText('Please enter and save your API key above.');
});

test('subscribes through the REST UI', async ({ page }) => {
  await page.goto('/');

  await page.locator('#globalApiKey').fill(API_KEY);
  await page.locator('#email').fill('ui-subscribe@example.com');
  await page.locator('#repo').fill('https://github.com/golang/go');
  await page.getByRole('button', { name: 'Subscribe to releases' }).click();

  await expect(page.locator('#message')).toHaveText('Subscribed! Check your email to confirm.');
});

test('shows confirmed subscriptions in the main page lookup', async ({ page }) => {
  await subscribeAndConfirm(page, 'ui-list@example.com', 'golang/go');
  await page.goto('/');

  await page.locator('#globalApiKey').fill(API_KEY);
  await page.locator('#checkEmail').fill('ui-list@example.com');
  await page.getByRole('button', { name: 'Check subscriptions' }).click();

  await expect(page.locator('#subscriptionsList')).toContainText('golang/go');
  await expect(page.locator('#subscriptionsList')).toContainText('Confirmed');
});

test('shows the empty state when no subscriptions exist', async ({ page }) => {
  await page.goto('/');

  await page.locator('#globalApiKey').fill(API_KEY);
  await page.locator('#checkEmail').fill('empty@example.com');
  await page.getByRole('button', { name: 'Check subscriptions' }).click();

  await expect(page.locator('#subscriptionsList')).toContainText(
    'No subscriptions found for this email.',
  );
});
