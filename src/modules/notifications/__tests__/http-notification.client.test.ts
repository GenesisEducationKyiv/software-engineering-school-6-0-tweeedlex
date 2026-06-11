import { HttpNotificationClient } from '@/modules/notifications/http-notification.client';

const logger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
  child() {
    return logger;
  },
} as never;

describe('HttpNotificationClient', () => {
  it('POSTs confirmation to the service with the api key header', async () => {
    const seen: { url?: string; body?: unknown; headers?: Record<string, string> } = {};
    const fetchImpl = (async (
      url: string,
      init: { body: string; headers: Record<string, string> },
    ) => {
      seen.url = url;
      seen.body = JSON.parse(init.body);
      seen.headers = init.headers;
      return { ok: true, status: 202, json: async () => ({ status: 'accepted', jobId: 'j' }) };
    }) as unknown as typeof fetch;

    const client = new HttpNotificationClient('http://notif:3100', 'k', logger, fetchImpl);
    await client.sendConfirmation('a@b.c', 't', 'o/r');

    expect(seen.url).toBe('http://notif:3100/notifications/confirmation');
    expect(seen.body).toMatchObject({ email: 'a@b.c', confirmToken: 't', repo: 'o/r' });
    expect(seen.headers?.['x-api-key']).toBe('k');
  });

  it('POSTs release notification with the release payload', async () => {
    const seen: { url?: string; body?: unknown } = {};
    const fetchImpl = (async (url: string, init: { body: string }) => {
      seen.url = url;
      seen.body = JSON.parse(init.body);
      return { ok: true, status: 202, json: async () => ({ status: 'accepted', jobId: 'j' }) };
    }) as unknown as typeof fetch;
    const client = new HttpNotificationClient('http://notif:3100', 'k', logger, fetchImpl);
    const release = {
      tagName: 'v1',
      name: 'n',
      htmlUrl: 'http://x',
      publishedAt: '2026-01-01T00:00:00Z',
    };
    await client.sendReleaseNotification('a@b.c', 'u', 'o/r', release as never);
    expect(seen.url).toBe('http://notif:3100/notifications/release');
    expect(seen.body).toMatchObject({
      email: 'a@b.c',
      unsubscribeToken: 'u',
      repo: 'o/r',
      release,
    });
  });

  it('throws when the service responds non-ok', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const client = new HttpNotificationClient('http://notif:3100', 'k', logger, fetchImpl);
    await expect(client.sendConfirmation('a@b.c', 't', 'o/r')).rejects.toThrow();
  });
});
