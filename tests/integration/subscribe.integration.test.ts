import {
  APP_BASE_URL,
  expectConfirmationEmail,
  postJson,
  prisma,
  subscribe,
  uniqueEmail,
  uniqueRepo,
  useIsolatedState,
} from './helpers';

describe('POST /api/subscribe', () => {
  useIsolatedState();

  it('subscribes with a GitHub URL and captures a confirmation email', async () => {
    const email = uniqueEmail('subscribe');
    const repoUrl = 'https://github.com/golang/go';
    const response = await subscribe(email, repoUrl);

    expect(response.status).toBe(200);

    const subscription = await prisma.subscription.findFirstOrThrow({
      where: { email },
      include: { repo: true },
    });
    expect(subscription.confirmed).toBe(false);
    expect(subscription.repo.owner).toBe('golang');
    expect(subscription.repo.name).toBe('go');

    expect(subscription.confirmToken).not.toBeNull();
    await expectConfirmationEmail(email, repoUrl, subscription.confirmToken as string);
  });

  it('returns 401 without an API key', async () => {
    const email = uniqueEmail('no-key');
    const response = await fetch(`${APP_BASE_URL}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, repo: uniqueRepo() }),
    });

    expect(response.status).toBe(401);
    expect(await prisma.subscription.count({ where: { email } })).toBe(0);
  });

  it('returns 401 with the wrong API key', async () => {
    const email = uniqueEmail('wrong-key');
    const response = await postJson('/api/subscribe', { email, repo: uniqueRepo() }, 'wrong-key');

    expect(response.status).toBe(401);
    expect(await prisma.subscription.count({ where: { email } })).toBe(0);
  });

  it('returns 400 for invalid input', async () => {
    const response = await postJson('/api/subscribe', {
      email: 'not-an-email',
      repo: uniqueRepo(),
    });

    expect(response.status).toBe(400);
  });

  it('returns 404 when GitHub reports that the repository does not exist', async () => {
    const email = uniqueEmail('missing');
    const response = await subscribe(email, 'missing/repo');

    expect(response.status).toBe(404);
    expect(await prisma.subscription.count({ where: { email } })).toBe(0);
  });

  it('returns 409 for duplicate subscriptions', async () => {
    const email = uniqueEmail('dup');
    const repo = uniqueRepo();
    expect((await subscribe(email, repo)).status).toBe(200);

    const response = await subscribe(email, repo);

    expect(response.status).toBe(409);
    expect(await prisma.subscription.count({ where: { email } })).toBe(1);
  });

  it('returns 429 when GitHub rate limits repo validation', async () => {
    const email = uniqueEmail('rate');
    const response = await subscribe(email, 'rate/limited');

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(await prisma.subscription.count({ where: { email } })).toBe(0);
  });
});
