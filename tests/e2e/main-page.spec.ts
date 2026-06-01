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

async function subscribeAndConfirm(email: string, repo: string) {
  const subscribeResponse = await fetch(`${APP_BASE_URL}/api/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({ email, repo }),
  });
  expect(subscribeResponse.status).toBe(200);

  const subscription = await prisma.subscription.findFirstOrThrow({ where: { email } });
  if (!subscription.confirmToken) throw new Error(`No confirmation token for ${email}`);

  const confirmResponse = await fetch(`${APP_BASE_URL}/api/confirm/${subscription.confirmToken}`);
  expect(confirmResponse.status).toBe(200);
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
  await subscribeAndConfirm('ui-list@example.com', 'golang/go');
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
