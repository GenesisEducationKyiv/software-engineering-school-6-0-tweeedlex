import type { ILogger } from '@/shared/logger';
import type { ConsumeMessage } from 'amqplib';
import type { BrokerMessage, ConsumeResult, MessageHandler } from '../message-broker.interface';
import { RabbitMqConsumer } from '../rabbitmq/rabbitmq-consumer';
import { TOPOLOGY } from '../rabbitmq/topology';

const silentLogger: ILogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as ILogger;

// Captures the callback amqplib's channel.consume() is given so tests can
// drive deliveries directly.
function buildMockChannel() {
  let onMessage: (msg: ConsumeMessage | null) => void = () => {};
  const channel = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    prefetch: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockImplementation((_q: string, cb: typeof onMessage) => {
      onMessage = cb;
      return Promise.resolve({ consumerTag: 't' });
    }),
    ack: jest.fn(),
    nack: jest.fn(),
    sendToQueue: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { channel, deliver: (msg: ConsumeMessage | null) => onMessage(msg) };
}

function makeMessage(
  payload: unknown,
  opts: { routingKey?: string; xDeathCount?: number } = {},
): ConsumeMessage {
  const headers: Record<string, unknown> = {};
  if (opts.xDeathCount !== undefined) {
    headers['x-death'] = [{ count: opts.xDeathCount, queue: TOPOLOGY.retryQueue }];
  }
  return {
    content: Buffer.from(JSON.stringify(payload)),
    fields: { routingKey: opts.routingKey ?? 'subscription.created' } as never,
    properties: { headers } as never,
  } as ConsumeMessage;
}

const connectionStub = (channel: unknown) =>
  ({ getChannel: jest.fn().mockResolvedValue(channel), close: jest.fn() }) as never;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

describe('RabbitMqConsumer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('acks the message when the handler returns ack', async () => {
    const { channel, deliver } = buildMockChannel();
    const handler: MessageHandler<unknown> = jest.fn().mockResolvedValue('ack' as ConsumeResult);
    const consumer = new RabbitMqConsumer(
      connectionStub(channel),
      { retryDelayMs: RETRY_DELAY_MS, maxAttempts: MAX_ATTEMPTS },
      silentLogger,
    );

    await consumer.start(handler);
    const msg = makeMessage({ v: 1, email: 'a@b.c' });
    await deliver(msg);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('passes routingKey, parsed payload, and attempt to the handler', async () => {
    const { channel, deliver } = buildMockChannel();
    let received: BrokerMessage<unknown> | undefined;
    const handler: MessageHandler<unknown> = jest
      .fn()
      .mockImplementation((m: BrokerMessage<unknown>) => {
        received = m;
        return Promise.resolve('ack' as ConsumeResult);
      });
    const consumer = new RabbitMqConsumer(
      connectionStub(channel),
      { retryDelayMs: RETRY_DELAY_MS, maxAttempts: MAX_ATTEMPTS },
      silentLogger,
    );

    await consumer.start(handler);
    await deliver(
      makeMessage({ v: 1, repo: 'golang/go' }, { routingKey: 'release.detected', xDeathCount: 2 }),
    );

    expect(received?.routingKey).toBe('release.detected');
    expect(received?.payload).toEqual({ v: 1, repo: 'golang/go' });
    expect(received?.attempt).toBe(2);
  });

  it('nacks without requeue when the handler returns retry and attempts remain', async () => {
    const { channel, deliver } = buildMockChannel();
    const handler: MessageHandler<unknown> = jest.fn().mockResolvedValue('retry' as ConsumeResult);
    const consumer = new RabbitMqConsumer(
      connectionStub(channel),
      { retryDelayMs: RETRY_DELAY_MS, maxAttempts: MAX_ATTEMPTS },
      silentLogger,
    );

    await consumer.start(handler);
    const msg = makeMessage({ v: 1 }, { xDeathCount: 1 });
    await deliver(msg);

    // requeue=false routes the message to the DLX -> retry queue.
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('sends to parking-lot and acks when attempts are exhausted', async () => {
    const { channel, deliver } = buildMockChannel();
    const handler: MessageHandler<unknown> = jest.fn().mockResolvedValue('retry' as ConsumeResult);
    const consumer = new RabbitMqConsumer(
      connectionStub(channel),
      { retryDelayMs: RETRY_DELAY_MS, maxAttempts: MAX_ATTEMPTS },
      silentLogger,
    );

    await consumer.start(handler);
    const msg = makeMessage({ v: 1 }, { xDeathCount: MAX_ATTEMPTS });
    await deliver(msg);

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      TOPOLOGY.parkingLot,
      msg.content,
      expect.objectContaining({ persistent: true }),
    );
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('sends unparseable messages straight to parking-lot and acks (no retry loop)', async () => {
    const { channel, deliver } = buildMockChannel();
    const handler: MessageHandler<unknown> = jest.fn();
    const consumer = new RabbitMqConsumer(
      connectionStub(channel),
      { retryDelayMs: RETRY_DELAY_MS, maxAttempts: MAX_ATTEMPTS },
      silentLogger,
    );

    await consumer.start(handler);
    const bad = {
      content: Buffer.from('not json{'),
      fields: { routingKey: 'x' },
      properties: { headers: {} },
    } as never;
    await deliver(bad);

    expect(handler).not.toHaveBeenCalled();
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      TOPOLOGY.parkingLot,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
    expect(channel.ack).toHaveBeenCalledWith(bad);
  });

  it('treats a handler exception as retry', async () => {
    const { channel, deliver } = buildMockChannel();
    const handler: MessageHandler<unknown> = jest.fn().mockRejectedValue(new Error('boom'));
    const consumer = new RabbitMqConsumer(
      connectionStub(channel),
      { retryDelayMs: RETRY_DELAY_MS, maxAttempts: MAX_ATTEMPTS },
      silentLogger,
    );

    await consumer.start(handler);
    const msg = makeMessage({ v: 1 }, { xDeathCount: 0 });
    await deliver(msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
  });
});
