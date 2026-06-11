import 'reflect-metadata';
import { GrpcNotificationClient } from '@/modules/notifications/grpc-notification.client';
import {
  buildNotificationGrpcServer,
  startNotificationGrpcServer,
} from '@/services/notification/grpc/notification.server';

const logger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
  child() {
    return logger;
  },
} as never;

describe('GrpcNotificationClient (integration)', () => {
  it('round-trips confirmation + release through a real gRPC server', async () => {
    const calls: Array<{ kind: string; payload: unknown }> = [];
    const ingress = {
      enqueueConfirmation: async (p: unknown) => {
        calls.push({ kind: 'confirmation', payload: p });
        return { status: 'accepted', jobId: 'j' };
      },
      enqueueRelease: async (p: unknown) => {
        calls.push({ kind: 'release', payload: p });
        return { status: 'accepted', jobId: 'j' };
      },
    };
    const server = buildNotificationGrpcServer({ ingress: ingress as never, apiKey: 'k', logger });
    const port = 50099;
    await startNotificationGrpcServer(server, port, logger);

    const client = new GrpcNotificationClient(`localhost:${port}`, 'k', logger);
    await client.sendConfirmation('a@b.c', 't', 'o/r');
    await client.sendReleaseNotification('a@b.c', 'u', 'o/r', {
      tagName: 'v1',
      name: 'n',
      htmlUrl: 'http://x',
      publishedAt: '2026-01-01T00:00:00Z',
    } as never);

    expect(calls[0]).toMatchObject({
      kind: 'confirmation',
      payload: { email: 'a@b.c', confirmToken: 't', repo: 'o/r' },
    });
    expect(calls[1]).toMatchObject({
      kind: 'release',
      payload: { email: 'a@b.c', unsubscribeToken: 'u', repo: 'o/r' },
    });

    client.close();
    server.forceShutdown();
  });

  it('rejects when the api key is wrong', async () => {
    const ingress = {
      enqueueConfirmation: async () => ({ status: 'accepted', jobId: 'j' }),
      enqueueRelease: async () => ({ status: 'accepted', jobId: 'j' }),
    };
    const server = buildNotificationGrpcServer({
      ingress: ingress as never,
      apiKey: 'right',
      logger,
    });
    const port = 50098;
    await startNotificationGrpcServer(server, port, logger);
    const client = new GrpcNotificationClient(`localhost:${port}`, 'wrong', logger);
    await expect(client.sendConfirmation('a@b.c', 't', 'o/r')).rejects.toBeDefined();
    client.close();
    server.forceShutdown();
  });
});
