import { PrismaClient } from '@prisma/client';

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const MOCK_SERVICE_URL = process.env.MOCK_SERVICE_URL || 'http://localhost:4000';
const API_KEY = process.env.API_KEY || 'test-api-key';
const VALID_MISSING_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const prisma = new PrismaClient();

async function resetState() {
  await prisma.subscription.deleteMany();
  await prisma.repo.deleteMany();
  await fetch(`${MOCK_SERVICE_URL}/emails/reset`, { method: 'POST' });
  await fetch(`${MOCK_SERVICE_URL}/github/__admin/reset`, { method: 'POST' });
}

async function postJson(path: string, body: unknown, apiKey = API_KEY): Promise<Response> {
  return fetch(`${APP_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
}

async function subscribe(email: string, repo: string): Promise<Response> {
  return postJson('/api/subscribe', { email, repo });
}

async function getConfirmToken(email: string): Promise<string> {
  const subscription = await prisma.subscription.findFirstOrThrow({ where: { email } });
  if (!subscription.confirmToken) throw new Error(`No confirmation token for ${email}`);
  return subscription.confirmToken;
}

async function getUnsubscribeToken(email: string): Promise<string> {
  const subscription = await prisma.subscription.findFirstOrThrow({ where: { email } });
  return subscription.unsubscribeToken;
}

async function waitForEmailCount(count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const emailsResponse = await fetch(`${MOCK_SERVICE_URL}/emails`);
    const { emails } = (await emailsResponse.json()) as { emails: unknown[] };
    if (emails.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Expected at least ${count} captured emails`);
}

describe('HTTP /api integration', () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/subscribe', () => {
    it('subscribes with a GitHub URL and captures a confirmation email', async () => {
      const response = await subscribe('test@example.com', 'https://github.com/golang/go');

      expect(response.status).toBe(200);

      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { email: 'test@example.com' },
        include: { repo: true },
      });
      expect(subscription.confirmed).toBe(false);
      expect(subscription.repo.owner).toBe('golang');
      expect(subscription.repo.name).toBe('go');

      await waitForEmailCount(1);
    });

    it('returns 401 without an API key', async () => {
      const response = await fetch(`${APP_BASE_URL}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', repo: 'golang/go' }),
      });

      expect(response.status).toBe(401);
      expect(await prisma.subscription.count()).toBe(0);
    });

    it('returns 401 with the wrong API key', async () => {
      const response = await postJson(
        '/api/subscribe',
        { email: 'test@example.com', repo: 'golang/go' },
        'wrong-key',
      );

      expect(response.status).toBe(401);
      expect(await prisma.subscription.count()).toBe(0);
    });

    it('returns 400 for invalid input', async () => {
      const response = await postJson('/api/subscribe', {
        email: 'not-an-email',
        repo: 'golang/go',
      });

      expect(response.status).toBe(400);
      expect(await prisma.subscription.count()).toBe(0);
    });

    it('returns 404 when GitHub reports that the repository does not exist', async () => {
      const response = await subscribe('test@example.com', 'missing/repo');

      expect(response.status).toBe(404);
      expect(await prisma.subscription.count()).toBe(0);
    });

    it('returns 409 for duplicate subscriptions', async () => {
      expect((await subscribe('test@example.com', 'golang/go')).status).toBe(200);

      const response = await subscribe('test@example.com', 'golang/go');

      expect(response.status).toBe(409);
      expect(await prisma.subscription.count()).toBe(1);
    });

    it('returns 429 when GitHub rate limits repo validation', async () => {
      const response = await subscribe('test@example.com', 'rate/limited');

      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBeTruthy();
      expect(await prisma.subscription.count()).toBe(0);
    });
  });

  describe('GET /api/confirm/:token', () => {
    it('confirms a subscription', async () => {
      await subscribe('confirm@example.com', 'golang/go');
      const token = await getConfirmToken('confirm@example.com');

      const response = await fetch(`${APP_BASE_URL}/api/confirm/${token}`);

      expect(response.status).toBe(200);
      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { email: 'confirm@example.com' },
      });
      expect(subscription.confirmed).toBe(true);
      expect(subscription.confirmToken).toBeNull();
    });

    it('returns 400 for an invalid token', async () => {
      const response = await fetch(`${APP_BASE_URL}/api/confirm/bad-token`);

      expect(response.status).toBe(400);
    });

    it('returns 404 for a missing or reused token', async () => {
      await subscribe('reused@example.com', 'golang/go');
      const token = await getConfirmToken('reused@example.com');
      expect((await fetch(`${APP_BASE_URL}/api/confirm/${token}`)).status).toBe(200);

      expect((await fetch(`${APP_BASE_URL}/api/confirm/${token}`)).status).toBe(404);
      expect((await fetch(`${APP_BASE_URL}/api/confirm/${VALID_MISSING_TOKEN}`)).status).toBe(404);
    });
  });

  describe('GET /api/unsubscribe/:token', () => {
    it('unsubscribes with a valid token', async () => {
      await subscribe('unsubscribe@example.com', 'golang/go');
      const token = await getUnsubscribeToken('unsubscribe@example.com');

      const response = await fetch(`${APP_BASE_URL}/api/unsubscribe/${token}`);

      expect(response.status).toBe(200);
      expect(await prisma.subscription.count()).toBe(0);
    });

    it('returns 400 for an invalid token', async () => {
      const response = await fetch(`${APP_BASE_URL}/api/unsubscribe/bad-token`);

      expect(response.status).toBe(400);
    });

    it('returns 404 for a missing token', async () => {
      const response = await fetch(`${APP_BASE_URL}/api/unsubscribe/${VALID_MISSING_TOKEN}`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/subscriptions', () => {
    it('returns confirmed subscriptions only', async () => {
      await subscribe('list@example.com', 'golang/go');
      await subscribe('list@example.com', 'nodejs/node');
      const token = await getConfirmToken('list@example.com');
      expect((await fetch(`${APP_BASE_URL}/api/confirm/${token}`)).status).toBe(200);

      const response = await fetch(
        `${APP_BASE_URL}/api/subscriptions?email=${encodeURIComponent('list@example.com')}`,
        { headers: { 'X-API-Key': API_KEY } },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        {
          email: 'list@example.com',
          repo: 'golang/go',
          confirmed: true,
          last_seen_tag: '',
        },
      ]);
    });

    it('returns an empty array for an email without confirmed subscriptions', async () => {
      const response = await fetch(
        `${APP_BASE_URL}/api/subscriptions?email=${encodeURIComponent('nobody@example.com')}`,
        { headers: { 'X-API-Key': API_KEY } },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });

    it('returns 400 for invalid email', async () => {
      const response = await fetch(`${APP_BASE_URL}/api/subscriptions?email=bad-email`, {
        headers: { 'X-API-Key': API_KEY },
      });

      expect(response.status).toBe(400);
    });

    it('returns 401 without or with the wrong API key', async () => {
      const noKey = await fetch(
        `${APP_BASE_URL}/api/subscriptions?email=${encodeURIComponent('test@example.com')}`,
      );
      const wrongKey = await fetch(
        `${APP_BASE_URL}/api/subscriptions?email=${encodeURIComponent('test@example.com')}`,
        { headers: { 'X-API-Key': 'wrong-key' } },
      );

      expect(noKey.status).toBe(401);
      expect(wrongKey.status).toBe(401);
    });
  });

  describe('POST /api/grpc-proxy', () => {
    it('calls the native gRPC server through the HTTP proxy', async () => {
      await subscribe('grpc@example.com', 'golang/go');
      const token = await getConfirmToken('grpc@example.com');
      expect((await fetch(`${APP_BASE_URL}/api/confirm/${token}`)).status).toBe(200);

      const response = await postJson('/api/grpc-proxy', {
        method: 'GetSubscriptions',
        payload: { email: 'grpc@example.com' },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        subscriptions: [
          {
            email: 'grpc@example.com',
            repo: 'golang/go',
            confirmed: true,
            lastSeenTag: '',
          },
        ],
      });
    });

    it('returns 400 for an unknown gRPC method', async () => {
      const response = await postJson('/api/grpc-proxy', { method: 'BadMethod', payload: {} });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message: 'Unknown gRPC method: BadMethod' });
    });

    it('returns 401 without or with the wrong API key', async () => {
      const body = JSON.stringify({ method: 'GetSubscriptions', payload: { email: 'a@b.com' } });
      const noKey = await fetch(`${APP_BASE_URL}/api/grpc-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const wrongKey = await postJson(
        '/api/grpc-proxy',
        { method: 'GetSubscriptions', payload: { email: 'a@b.com' } },
        'wrong-key',
      );

      expect(noKey.status).toBe(401);
      expect(wrongKey.status).toBe(401);
    });
  });

  describe('GET /api/metrics', () => {
    it('returns Prometheus metrics including HTTP request counters', async () => {
      await fetch(`${APP_BASE_URL}/api/metrics`);

      const response = await fetch(`${APP_BASE_URL}/api/metrics`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(body).toContain('http_requests_total');
    });
  });
});
