import 'reflect-metadata';
import { buildNotificationHttpServer } from '@/services/notification/http/server';

const logger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
  child() {
    return logger;
  },
} as never;

describe('notification HTTP server', () => {
  it('POST /notifications/confirmation returns 202 and delegates to ingress', async () => {
    const calls: unknown[] = [];
    const ingress = {
      enqueueConfirmation: async (p: unknown) => {
        calls.push(p);
        return { status: 'accepted', jobId: 'j' };
      },
      enqueueRelease: async () => ({ status: 'accepted', jobId: 'j' }),
    };
    const app = await buildNotificationHttpServer({
      ingress: ingress as never,
      apiKey: 'k',
      logger,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/confirmation',
      headers: { 'x-api-key': 'k' },
      payload: { email: 'a@b.c', confirmToken: 't', repo: 'o/r' },
    });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'accepted' });
    expect(calls[0]).toMatchObject({ email: 'a@b.c', confirmToken: 't', repo: 'o/r' });
    await app.close();
  });

  it('POST /notifications/release returns 202', async () => {
    const ingress = {
      enqueueConfirmation: async () => ({ status: 'accepted', jobId: 'j' }),
      enqueueRelease: async () => ({ status: 'accepted', jobId: 'j' }),
    };
    const app = await buildNotificationHttpServer({
      ingress: ingress as never,
      apiKey: 'k',
      logger,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/release',
      headers: { 'x-api-key': 'k' },
      payload: {
        email: 'a@b.c',
        unsubscribeToken: 'u',
        repo: 'o/r',
        release: {
          tagName: 'v1',
          name: 'n',
          htmlUrl: 'http://x',
          publishedAt: '2026-01-01T00:00:00Z',
        },
      },
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });

  it('returns 401 with a bad api key', async () => {
    const ingress = {
      enqueueConfirmation: async () => ({ status: 'accepted', jobId: 'j' }),
      enqueueRelease: async () => ({ status: 'accepted', jobId: 'j' }),
    };
    const app = await buildNotificationHttpServer({
      ingress: ingress as never,
      apiKey: 'k',
      logger,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/confirmation',
      headers: { 'x-api-key': 'wrong' },
      payload: { email: 'a@b.c', confirmToken: 't', repo: 'o/r' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
