import 'reflect-metadata';
import { IngressService } from '@/services/notification/ingress.service';

describe('IngressService', () => {
  const logger = {
    info() {},
    error() {},
    warn() {},
    debug() {},
    child() {
      return logger;
    },
  } as never;

  it('enqueues a confirmation job and returns an accepted ack', async () => {
    const enqueued: Array<{ name: string; data: unknown }> = [];
    const producer = {
      enqueue: async (name: string, data: unknown) => {
        enqueued.push({ name, data });
      },
      close: async () => {},
    };
    const svc = new IngressService(producer as never, logger);
    const res = await svc.enqueueConfirmation({ email: 'a@b.c', confirmToken: 't', repo: 'o/r' });
    expect(res.status).toBe('accepted');
    expect(typeof res.jobId).toBe('string');
    expect(enqueued[0].name).toBe('send-confirmation');
    expect(enqueued[0].data).toMatchObject({
      type: 'confirmation',
      email: 'a@b.c',
      confirmToken: 't',
      repo: 'o/r',
    });
  });

  it('enqueues a release job', async () => {
    const enqueued: Array<{ name: string; data: unknown }> = [];
    const producer = {
      enqueue: async (name: string, data: unknown) => {
        enqueued.push({ name, data });
      },
      close: async () => {},
    };
    const svc = new IngressService(producer as never, logger);
    const release = {
      tagName: 'v1',
      name: 'n',
      htmlUrl: 'http://x',
      publishedAt: '2026-01-01T00:00:00Z',
    };
    const res = await svc.enqueueRelease({
      email: 'a@b.c',
      unsubscribeToken: 'u',
      repo: 'o/r',
      release,
    });
    expect(res.status).toBe('accepted');
    expect(enqueued[0].name).toBe('send-release-notification');
    expect(enqueued[0].data).toMatchObject({
      type: 'release-notification',
      email: 'a@b.c',
      unsubscribeToken: 'u',
      repo: 'o/r',
      release,
    });
  });
});
