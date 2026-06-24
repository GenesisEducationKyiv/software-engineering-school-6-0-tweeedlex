import {
  APP_BASE_URL,
  getConfirmToken,
  postJson,
  subscribe,
  uniqueEmail,
  uniqueRepo,
  useIsolatedState,
} from './helpers';

describe('POST /api/grpc-proxy', () => {
  useIsolatedState();

  it('calls the native gRPC server through the HTTP proxy', async () => {
    const email = uniqueEmail('grpc');
    const repo = uniqueRepo();
    await subscribe(email, repo);
    const token = await getConfirmToken(email, repo);
    expect((await fetch(`${APP_BASE_URL}/api/confirm/${token}`)).status).toBe(200);

    const response = await postJson('/api/grpc-proxy', {
      method: 'GetSubscriptions',
      payload: { email },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      subscriptions: [
        {
          email,
          repo,
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
