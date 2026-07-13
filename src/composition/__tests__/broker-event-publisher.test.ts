import { NEW_RELEASE_DETECTED } from '@/shared/events';
import type { NewReleaseDetectedEvent } from '@/shared/events';
import type { IMessagePublisher } from '@/shared/messaging';
import { MESSAGE_SCHEMA_VERSION, ROUTING_KEYS } from '@/shared/messaging';
import { BrokerEventPublisher } from '../broker-event-publisher';

const publisher = {
  publish: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
} as unknown as jest.Mocked<IMessagePublisher>;

const release = { tagName: 'v1', name: 'One', htmlUrl: 'https://x', publishedAt: null };
const releaseEvent: NewReleaseDetectedEvent = {
  type: NEW_RELEASE_DETECTED,
  repoSlug: 'golang/go',
  release,
  subscribers: [{ email: 'a@b.c', unsubscribeToken: 'u1' }],
  occurredAt: '2026-06-19T00:00:00Z',
};

describe('BrokerEventPublisher', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publishes release.detected with the mapped payload', async () => {
    const sut = new BrokerEventPublisher(publisher);
    await sut.onNewReleaseDetected(releaseEvent);
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
    await expect(sut.onNewReleaseDetected(releaseEvent)).rejects.toThrow('broker down');
  });
});
