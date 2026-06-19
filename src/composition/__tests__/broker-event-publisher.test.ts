import { NEW_RELEASE_DETECTED, SUBSCRIPTION_CREATED } from '@/shared/events';
import type { NewReleaseDetectedEvent, SubscriptionCreatedEvent } from '@/shared/events';
import type { IMessagePublisher } from '@/shared/messaging';
import { MESSAGE_SCHEMA_VERSION, ROUTING_KEYS } from '@/shared/messaging';
import { BrokerEventPublisher } from '../broker-event-publisher';

const publisher = {
  publish: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
} as unknown as jest.Mocked<IMessagePublisher>;

describe('BrokerEventPublisher', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publishes subscription.created with the mapped payload', async () => {
    const sut = new BrokerEventPublisher(publisher);
    const event: SubscriptionCreatedEvent = {
      type: SUBSCRIPTION_CREATED,
      email: 'a@b.c',
      repoSlug: 'golang/go',
      confirmToken: 'tok',
      occurredAt: '2026-06-19T00:00:00Z',
    };
    await sut.onSubscriptionCreated(event);
    expect(publisher.publish).toHaveBeenCalledWith(ROUTING_KEYS.SUBSCRIPTION_CREATED, {
      v: MESSAGE_SCHEMA_VERSION,
      email: 'a@b.c',
      repo: 'golang/go',
      confirmToken: 'tok',
    });
  });

  it('publishes release.detected with the mapped payload', async () => {
    const sut = new BrokerEventPublisher(publisher);
    const release = { tagName: 'v1', name: 'One', htmlUrl: 'https://x', publishedAt: null };
    const event: NewReleaseDetectedEvent = {
      type: NEW_RELEASE_DETECTED,
      repoSlug: 'golang/go',
      release,
      subscribers: [{ email: 'a@b.c', unsubscribeToken: 'u1' }],
      occurredAt: '2026-06-19T00:00:00Z',
    };
    await sut.onNewReleaseDetected(event);
    expect(publisher.publish).toHaveBeenCalledWith(ROUTING_KEYS.RELEASE_DETECTED, {
      v: MESSAGE_SCHEMA_VERSION,
      repo: 'golang/go',
      release,
      subscribers: [{ email: 'a@b.c', unsubscribeToken: 'u1' }],
    });
  });

  it('propagates a publish failure', async () => {
    publisher.publish.mockRejectedValueOnce(new Error('broker down'));
    const sut = new BrokerEventPublisher(publisher);
    await expect(
      sut.onSubscriptionCreated({
        type: SUBSCRIPTION_CREATED,
        email: 'a@b.c',
        repoSlug: 'x',
        confirmToken: 't',
        occurredAt: '2026-06-19T00:00:00Z',
      }),
    ).rejects.toThrow('broker down');
  });
});
