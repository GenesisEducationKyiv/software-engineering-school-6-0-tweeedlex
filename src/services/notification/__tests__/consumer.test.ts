import type { BrokerMessage } from '@/shared/messaging';
import { type NotificationWireMessage, ROUTING_KEYS } from '@/shared/messaging';
import { buildNotificationConsumerHandler } from '../consumer';
import type { NotificationService } from '../internal/notification.service';

const service = {
  sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendReleaseNotification: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<NotificationService>;

function msg(
  routingKey: string,
  payload: NotificationWireMessage,
): BrokerMessage<NotificationWireMessage> {
  return { routingKey, payload, attempt: 0 };
}

describe('buildNotificationConsumerHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes a subscription.created message to sendConfirmationEmail', async () => {
    const handler = buildNotificationConsumerHandler(service);
    const result = await handler(
      msg(ROUTING_KEYS.SUBSCRIPTION_CREATED, {
        v: 1,
        email: 'a@b.c',
        repo: 'golang/go',
        confirmToken: 'tok',
      }),
    );
    expect(service.sendConfirmationEmail).toHaveBeenCalledWith('a@b.c', 'tok', 'golang/go');
    expect(result).toBe('ack');
  });

  it('routes a release.detected message to sendReleaseNotification once per subscriber', async () => {
    const handler = buildNotificationConsumerHandler(service);
    const release = { tagName: 'v1', name: 'One', htmlUrl: 'https://x', publishedAt: null };
    const result = await handler(
      msg(ROUTING_KEYS.RELEASE_DETECTED, {
        v: 1,
        repo: 'golang/go',
        release,
        subscribers: [
          { email: 'a@b.c', unsubscribeToken: 'u1' },
          { email: 'd@e.f', unsubscribeToken: 'u2' },
        ],
      }),
    );
    expect(service.sendReleaseNotification).toHaveBeenCalledTimes(2);
    expect(service.sendReleaseNotification).toHaveBeenNthCalledWith(
      1,
      'a@b.c',
      'u1',
      'golang/go',
      release,
    );
    expect(service.sendReleaseNotification).toHaveBeenNthCalledWith(
      2,
      'd@e.f',
      'u2',
      'golang/go',
      release,
    );
    expect(result).toBe('ack');
  });

  it('returns reject for an unknown routing key', async () => {
    const handler = buildNotificationConsumerHandler(service);
    const result = await handler(
      msg('unknown.key', { v: 1, email: 'a@b.c', repo: 'x', confirmToken: 't' }),
    );
    expect(result).toBe('reject');
    expect(service.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(service.sendReleaseNotification).not.toHaveBeenCalled();
  });

  it('returns retry when the service throws', async () => {
    service.sendConfirmationEmail.mockRejectedValueOnce(new Error('smtp down'));
    const handler = buildNotificationConsumerHandler(service);
    const result = await handler(
      msg(ROUTING_KEYS.SUBSCRIPTION_CREATED, {
        v: 1,
        email: 'a@b.c',
        repo: 'x',
        confirmToken: 't',
      }),
    );
    expect(result).toBe('retry');
  });
});
