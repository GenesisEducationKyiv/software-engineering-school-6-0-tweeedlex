import { NotificationHandlers } from '@/modules/notifications/notification.handlers';
import { NEW_RELEASE_DETECTED, SUBSCRIPTION_CREATED } from '@/shared/events';

const logger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
  child() {
    return logger;
  },
} as never;

describe('NotificationHandlers', () => {
  it('calls client.sendConfirmation on subscription.created', async () => {
    const client = {
      sendConfirmation: jest.fn(async () => {}),
      sendReleaseNotification: jest.fn(async () => {}),
    };
    const h = new NotificationHandlers(client as never, logger);
    await h.onSubscriptionCreated({
      type: SUBSCRIPTION_CREATED,
      email: 'a@b.c',
      repoSlug: 'o/r',
      confirmToken: 't',
      occurredAt: 'now',
    } as never);
    expect(client.sendConfirmation).toHaveBeenCalledWith('a@b.c', 't', 'o/r');
  });

  it('calls client.sendReleaseNotification for each subscriber on new-release', async () => {
    const client = {
      sendConfirmation: jest.fn(async () => {}),
      sendReleaseNotification: jest.fn(async () => {}),
    };
    const h = new NotificationHandlers(client as never, logger);
    const release = {
      tagName: 'v1',
      name: 'n',
      htmlUrl: 'http://x',
      publishedAt: '2026-01-01T00:00:00Z',
    };
    await h.onNewReleaseDetected({
      type: NEW_RELEASE_DETECTED,
      repoSlug: 'o/r',
      release,
      subscribers: [
        { email: 'a@b.c', unsubscribeToken: 'u' },
        { email: 'd@e.f', unsubscribeToken: 'u2' },
      ],
      occurredAt: 'now',
    } as never);
    expect(client.sendReleaseNotification).toHaveBeenCalledTimes(2);
    expect(client.sendReleaseNotification).toHaveBeenNthCalledWith(1, 'a@b.c', 'u', 'o/r', release);
  });
});
