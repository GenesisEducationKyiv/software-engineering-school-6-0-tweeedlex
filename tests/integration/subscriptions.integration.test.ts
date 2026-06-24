import { API_KEY, APP_BASE_URL, getConfirmToken, prisma, resetState, subscribe } from './helpers';

describe('GET /api/subscriptions', () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns confirmed subscriptions only', async () => {
    await subscribe('list@example.com', 'golang/go');
    await subscribe('list@example.com', 'nodejs/node');
    // Confirm only the golang/go subscription; the list must reflect exactly that one.
    const token = await getConfirmToken('list@example.com', 'golang/go');
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
