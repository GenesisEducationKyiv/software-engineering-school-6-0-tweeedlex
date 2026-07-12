import {
  APP_BASE_URL,
  VALID_MISSING_TOKEN,
  getConfirmToken,
  prisma,
  subscribe,
  uniqueEmail,
  uniqueRepo,
  useIsolatedState,
} from './helpers';

describe('GET /api/confirm/:token', () => {
  useIsolatedState();

  it('confirms a subscription', async () => {
    const email = uniqueEmail('confirm');
    const repo = uniqueRepo();
    await subscribe(email, repo);
    const token = await getConfirmToken(email, repo);

    const response = await fetch(`${APP_BASE_URL}/api/confirm/${token}`);

    expect(response.status).toBe(200);
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { email } });
    expect(subscription.confirmed).toBe(true);
    expect(subscription.confirmToken).toBeNull();
  });

  it('returns 400 for an invalid token', async () => {
    const response = await fetch(`${APP_BASE_URL}/api/confirm/bad-token`);

    expect(response.status).toBe(400);
  });

  it('returns 404 for a missing or reused token', async () => {
    const email = uniqueEmail('reused');
    const repo = uniqueRepo();
    await subscribe(email, repo);
    const token = await getConfirmToken(email, repo);
    expect((await fetch(`${APP_BASE_URL}/api/confirm/${token}`)).status).toBe(200);

    expect((await fetch(`${APP_BASE_URL}/api/confirm/${token}`)).status).toBe(404);
    expect((await fetch(`${APP_BASE_URL}/api/confirm/${VALID_MISSING_TOKEN}`)).status).toBe(404);
  });
});
