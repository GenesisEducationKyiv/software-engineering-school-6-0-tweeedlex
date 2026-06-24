import {
  APP_BASE_URL,
  VALID_MISSING_TOKEN,
  getUnsubscribeToken,
  prisma,
  subscribe,
  useIsolatedState,
} from './helpers';

describe('GET /api/unsubscribe/:token', () => {
  useIsolatedState();

  it('unsubscribes with a valid token', async () => {
    await subscribe('unsubscribe@example.com', 'golang/go');
    const token = await getUnsubscribeToken('unsubscribe@example.com', 'golang/go');

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
