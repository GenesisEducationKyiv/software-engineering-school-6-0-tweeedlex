import {
  APP_BASE_URL,
  expectConfirmationEmail,
  postJson,
  prisma,
  subscribe,
  useIsolatedState,
} from './helpers';

describe('POST /api/subscribe', () => {
  useIsolatedState();

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

    expect(subscription.confirmToken).not.toBeNull();
    await expectConfirmationEmail(
      'test@example.com',
      'https://github.com/golang/go',
      subscription.confirmToken as string,
    );
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
