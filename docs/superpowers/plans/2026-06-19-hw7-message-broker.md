# HW7 Message Broker (RabbitMQ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the synchronous RPC hop between the main service and the notification service with an asynchronous RabbitMQ broker; the notification service consumes domain events from the broker and sends email, with a DLX+TTL retry path.

**Architecture:** A new `src/shared/messaging/` abstraction (`IMessagePublisher` / `IMessageConsumer`) wraps `amqplib`. The main service keeps its in-process `IEventBus`; a `BrokerEventPublisher` (in the composition root) subscribes to the in-process bus and republishes the two domain events as versioned wire messages onto a durable topic exchange. The notification service replaces its BullMQ producer/worker with a RabbitMQ consumer that maps wire messages to `NotificationService`. Retry/backoff uses a dead-letter exchange + TTL retry queue; poison messages and exhausted retries go to a parking-lot queue.

**Tech Stack:** Node 20, TypeScript, `amqplib`, RabbitMQ (`rabbitmq:3-management`), tsyringe DI, Jest + ts-jest, Fastify (healthcheck only), Docker Compose.

**Conventions in this repo (read before starting):**
- Path alias: `@/*` maps to `src/*` (see `tsconfig.json`, `jest.unit.config.js`).
- Unit tests: `*.test.ts` next to code under `__tests__/`, ts-jest, run with `npm run test:unit:container` (runs `jest --config jest.unit.config.js --runInBand`). A faster local loop is `npx jest --config jest.unit.config.js <path> --runInBand`.
- Boundary rules (`.dependency-cruiser.cjs`): `shared/**` must NOT import `src/modules/**` or `src/services/**`; `modules/**` and `shared/**` must NOT import `src/services/**`. `composition/**` may import anything. This is why `BrokerEventPublisher` lives in `composition/`, not in a module.
- Lint gate: `npm run lint` = `biome check .` + `depcruise`. Run before each commit.
- Imports use `import type { ... }` for type-only imports (biome enforces it).

---

## File Structure

**New files (shared messaging — the broker abstraction):**
- `src/shared/messaging/message-broker.interface.ts` — `IMessagePublisher`, `IMessageConsumer`, `BrokerMessage`, `ConsumeResult`, `MessageHandler`.
- `src/shared/messaging/messaging.contract.ts` — routing-key constants + versioned wire message types + `NotificationWireMessage` union.
- `src/shared/messaging/rabbitmq/topology.ts` — exchange/queue/DLX names + `assertTopology(channel)`.
- `src/shared/messaging/rabbitmq/rabbitmq-connection.ts` — `amqplib` connection + channel lifecycle, reconnect, close.
- `src/shared/messaging/rabbitmq/rabbitmq-publisher.ts` — `RabbitMqPublisher implements IMessagePublisher`.
- `src/shared/messaging/rabbitmq/rabbitmq-consumer.ts` — `RabbitMqConsumer implements IMessageConsumer` (ack/retry/parking-lot logic).
- `src/shared/messaging/index.ts` — public barrel.
- `src/shared/messaging/__tests__/rabbitmq-consumer.test.ts`
- `src/composition/broker-event-publisher.ts` — `BrokerEventPublisher` + `registerBrokerEventPublisher(bus, publisher)`.
- `src/composition/__tests__/broker-event-publisher.test.ts`
- `src/services/notification/consumer.ts` — `buildNotificationConsumerHandler(service)` mapping wire message → `NotificationService`.
- `src/services/notification/__tests__/consumer.test.ts`

**Modified files:**
- `src/config/env.ts` — add `rabbitmqUrl`.
- `src/config/notification-env.ts` — add `rabbitmqUrl`, drop `redisUrl`, retry tunables.
- `src/infrastructure/infra.module.ts` — create + register a `RabbitMqConnection` instance.
- `src/composition/container.ts` — drop notification-client wiring; wire `BrokerEventPublisher`.
- `src/services/notification/container.ts` — drop BullMQ; wire RabbitMQ consumer.
- `src/services/notification/main.ts` — boot consumer instead of worker; shutdown closes RabbitMQ.
- `src/services/notification/http/server.ts` — reduce to `/healthz`.
- `docker-compose.yml` — add `rabbitmq`; repoint services; drop `notif-redis`.
- `.env.example` — add `RABBITMQ_URL`, retry tunables.
- `package.json` — add `amqplib` + `@types/amqplib`.

**Deleted files:**
- `src/modules/notifications/` (entire directory: clients, handlers, module, interface, tests).
- `src/services/notification/ingress.service.ts` + `src/services/notification/__tests__/ingress.service.test.ts`.
- `src/services/notification/internal/notification.worker.ts` + its test.
- `src/services/notification/internal/notification.queue.ts`.
- `src/services/notification/grpc/notification.server.ts` (gRPC ingress no longer used) — confirm no other reference before deleting.

---

## Task 1: Add `amqplib` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install amqplib and its types**

Run:
```bash
npm install amqplib@^0.10.4
npm install -D @types/amqplib@^0.10.5
```
Expected: `package.json` `dependencies` gains `"amqplib"`, `devDependencies` gains `"@types/amqplib"`; `package-lock.json` updated.

- [ ] **Step 2: Verify it imports**

Run:
```bash
npx tsx -e "import amqp from 'amqplib'; console.log(typeof amqp.connect)"
```
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(hw7): add amqplib dependency"
```

---

## Task 2: Broker interface and message contract

These are pure types/constants — no runtime, no test needed beyond compilation.

**Files:**
- Create: `src/shared/messaging/message-broker.interface.ts`
- Create: `src/shared/messaging/messaging.contract.ts`

- [ ] **Step 1: Write the broker interface**

`src/shared/messaging/message-broker.interface.ts`:
```typescript
/** Result a consumer handler returns; the consumer maps it to ack/nack. */
export type ConsumeResult = 'ack' | 'retry' | 'reject';

export interface BrokerMessage<T> {
  /** Routing key the message arrived on. */
  readonly routingKey: string;
  /** Parsed JSON payload. */
  readonly payload: T;
  /** How many times delivery has already been retried (from x-death). */
  readonly attempt: number;
}

export type MessageHandler<T> = (message: BrokerMessage<T>) => Promise<ConsumeResult>;

export interface IMessagePublisher {
  publish<T>(routingKey: string, payload: T): Promise<void>;
  close(): Promise<void>;
}

export interface IMessageConsumer {
  /** Start consuming the bound queue. Resolves once consumption is registered. */
  start<T>(handler: MessageHandler<T>): Promise<void>;
  close(): Promise<void>;
}
```

- [ ] **Step 2: Write the wire contract**

`src/shared/messaging/messaging.contract.ts`:
```typescript
import type { ReleaseEventPayload } from '@/shared/events';

/** Routing keys published to the notifications topic exchange. */
export const ROUTING_KEYS = {
  SUBSCRIPTION_CREATED: 'subscription.created',
  RELEASE_DETECTED: 'release.detected',
} as const;

export type RoutingKey = (typeof ROUTING_KEYS)[keyof typeof ROUTING_KEYS];

/** Wire schema version — bump on breaking payload changes. */
export const MESSAGE_SCHEMA_VERSION = 1 as const;

export interface SubscriptionCreatedMessage {
  v: typeof MESSAGE_SCHEMA_VERSION;
  email: string;
  repo: string;
  confirmToken: string;
}

export interface ReleaseSubscriber {
  email: string;
  unsubscribeToken: string;
}

export interface NewReleaseDetectedMessage {
  v: typeof MESSAGE_SCHEMA_VERSION;
  repo: string;
  release: ReleaseEventPayload;
  subscribers: ReleaseSubscriber[];
}

export type NotificationWireMessage = SubscriptionCreatedMessage | NewReleaseDetectedMessage;
```

- [ ] **Step 3: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors (the existing build may already be clean; if pre-existing unrelated errors exist, confirm none reference these two new files).

- [ ] **Step 4: Commit**

```bash
git add src/shared/messaging/message-broker.interface.ts src/shared/messaging/messaging.contract.ts
git commit -m "feat(hw7): add broker interface and wire message contract"
```

---

## Task 3: RabbitMQ topology declaration

**Files:**
- Create: `src/shared/messaging/rabbitmq/topology.ts`

- [ ] **Step 1: Write the topology**

`src/shared/messaging/rabbitmq/topology.ts`:
```typescript
import type { Channel } from 'amqplib';
import { ROUTING_KEYS } from '../messaging.contract';

export const TOPOLOGY = {
  exchange: 'notifications',
  dlx: 'notifications.dlx',
  queue: 'notifications.email',
  retryQueue: 'notifications.retry',
  parkingLot: 'notifications.parking-lot',
  /** Dead-letter routing key used inside the DLX (single key, direct exchange). */
  retryRoutingKey: 'retry',
} as const;

/**
 * Single source of truth for the retry-queue TTL. Both the publisher and the
 * consumer call assertTopology(); RabbitMQ rejects a queue redeclaration with
 * inequivalent args (PRECONDITION_FAILED), so both MUST use the same value.
 * The notification service overrides this from config; the main-service
 * publisher (no retry config) uses this default.
 */
export const RETRY_DELAY_MS = 5000;

export interface TopologyOptions {
  /** How long a message waits in the retry queue before redelivery. */
  retryDelayMs: number;
}

/**
 * Declares the full topic exchange + dead-letter retry path. Idempotent:
 * safe to call on every consumer/publisher start.
 *
 * Flow:
 *   main queue (notifications.email) --nack--> DLX --> retry queue (TTL)
 *     --expire--> dead-letters back to notifications exchange --> main queue
 *   parking-lot is a separate durable queue the consumer publishes to directly
 *   once attempts are exhausted or a message is unparseable.
 */
export async function assertTopology(channel: Channel, opts: TopologyOptions): Promise<void> {
  await channel.assertExchange(TOPOLOGY.exchange, 'topic', { durable: true });
  await channel.assertExchange(TOPOLOGY.dlx, 'direct', { durable: true });

  await channel.assertQueue(TOPOLOGY.queue, {
    durable: true,
    deadLetterExchange: TOPOLOGY.dlx,
    deadLetterRoutingKey: TOPOLOGY.retryRoutingKey,
  });
  await channel.bindQueue(TOPOLOGY.queue, TOPOLOGY.exchange, ROUTING_KEYS.SUBSCRIPTION_CREATED);
  await channel.bindQueue(TOPOLOGY.queue, TOPOLOGY.exchange, ROUTING_KEYS.RELEASE_DETECTED);

  // Retry queue: holds a message for retryDelayMs, then dead-letters it back to
  // the main exchange (default exchange routing by queue name would not re-bind,
  // so we route back through the topic exchange via the original routing key,
  // which amqp preserves in the message on dead-letter).
  await channel.assertQueue(TOPOLOGY.retryQueue, {
    durable: true,
    messageTtl: opts.retryDelayMs,
    deadLetterExchange: TOPOLOGY.exchange,
  });
  await channel.bindQueue(TOPOLOGY.retryQueue, TOPOLOGY.dlx, TOPOLOGY.retryRoutingKey);

  await channel.assertQueue(TOPOLOGY.parkingLot, { durable: true });
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors referencing this file.

- [ ] **Step 3: Commit**

```bash
git add src/shared/messaging/rabbitmq/topology.ts
git commit -m "feat(hw7): declare rabbitmq topology with DLX retry path"
```

---

## Task 4: RabbitMQ connection wrapper

**Files:**
- Create: `src/shared/messaging/rabbitmq/rabbitmq-connection.ts`

- [ ] **Step 1: Write the connection wrapper**

`src/shared/messaging/rabbitmq/rabbitmq-connection.ts`:
```typescript
import type { ILogger } from '@/shared/logger';
import amqp, { type ChannelModel, type Channel } from 'amqplib';

/**
 * Owns a single amqplib connection + channel. Lazily connects on first
 * getChannel(); reconnects on connection close (unless we asked it to close).
 */
export class RabbitMqConnection {
  private model: ChannelModel | null = null;
  private channel: Channel | null = null;
  private closing = false;

  constructor(
    private readonly url: string,
    private readonly logger: ILogger,
  ) {}

  async getChannel(): Promise<Channel> {
    if (this.channel) return this.channel;
    this.model = await amqp.connect(this.url);
    this.model.on('error', (err) => this.logger.error({ err }, 'RabbitMQ connection error'));
    this.model.on('close', () => {
      this.channel = null;
      this.model = null;
      if (!this.closing) {
        this.logger.warn('RabbitMQ connection closed unexpectedly');
      }
    });
    this.channel = await this.model.createChannel();
    this.logger.info('RabbitMQ connected');
    return this.channel;
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      await this.channel?.close();
      await this.model?.close();
    } finally {
      this.channel = null;
      this.model = null;
    }
  }
}
```

> Note: `amqplib` ≥0.10.4 types name the connection object `ChannelModel`. If the installed version exposes `Connection` instead, swap the type import accordingly — verify with `npx tsc --noEmit`.

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. If the `ChannelModel` type name mismatches, adjust per the note above and re-run.

- [ ] **Step 3: Commit**

```bash
git add src/shared/messaging/rabbitmq/rabbitmq-connection.ts
git commit -m "feat(hw7): add rabbitmq connection wrapper"
```

---

## Task 5: RabbitMQ publisher

**Files:**
- Create: `src/shared/messaging/rabbitmq/rabbitmq-publisher.ts`

- [ ] **Step 1: Write the publisher**

`src/shared/messaging/rabbitmq/rabbitmq-publisher.ts`:
```typescript
import type { ILogger } from '@/shared/logger';
import type { IMessagePublisher } from '../message-broker.interface';
import type { RabbitMqConnection } from './rabbitmq-connection';
import { TOPOLOGY, type TopologyOptions, assertTopology } from './topology';

export class RabbitMqPublisher implements IMessagePublisher {
  private asserted = false;

  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly topologyOpts: TopologyOptions,
    private readonly logger: ILogger,
  ) {}

  async publish<T>(routingKey: string, payload: T): Promise<void> {
    const channel = await this.connection.getChannel();
    if (!this.asserted) {
      await assertTopology(channel, this.topologyOpts);
      this.asserted = true;
    }
    const body = Buffer.from(JSON.stringify(payload));
    const ok = channel.publish(TOPOLOGY.exchange, routingKey, body, {
      persistent: true,
      contentType: 'application/json',
    });
    if (!ok) {
      this.logger.warn({ routingKey }, 'RabbitMQ publish buffer full, applying backpressure');
      await new Promise<void>((resolve) => channel.once('drain', resolve));
    }
    this.logger.debug({ routingKey }, 'Message published');
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors referencing this file.

- [ ] **Step 3: Commit**

```bash
git add src/shared/messaging/rabbitmq/rabbitmq-publisher.ts
git commit -m "feat(hw7): add rabbitmq publisher"
```

---

## Task 6: RabbitMQ consumer (with tests — graded logic)

This is the core graded component. We write tests first against a mocked `amqplib` channel.

**Files:**
- Create: `src/shared/messaging/rabbitmq/rabbitmq-consumer.ts`
- Test: `src/shared/messaging/__tests__/rabbitmq-consumer.test.ts`

- [ ] **Step 1: Write the failing test**

`src/shared/messaging/__tests__/rabbitmq-consumer.test.ts`:
```typescript
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
    const handler: MessageHandler<unknown> = jest.fn().mockImplementation((m: BrokerMessage<unknown>) => {
      received = m;
      return Promise.resolve('ack' as ConsumeResult);
    });
    const consumer = new RabbitMqConsumer(
      connectionStub(channel),
      { retryDelayMs: RETRY_DELAY_MS, maxAttempts: MAX_ATTEMPTS },
      silentLogger,
    );

    await consumer.start(handler);
    await deliver(makeMessage({ v: 1, repo: 'golang/go' }, { routingKey: 'release.detected', xDeathCount: 2 }));

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
    const bad = { content: Buffer.from('not json{'), fields: { routingKey: 'x' }, properties: { headers: {} } } as never;
    await deliver(bad);

    expect(handler).not.toHaveBeenCalled();
    expect(channel.sendToQueue).toHaveBeenCalledWith(TOPOLOGY.parkingLot, expect.any(Buffer), expect.objectContaining({ persistent: true }));
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx jest --config jest.unit.config.js src/shared/messaging/__tests__/rabbitmq-consumer.test.ts --runInBand
```
Expected: FAIL — cannot find module `../rabbitmq/rabbitmq-consumer`.

- [ ] **Step 3: Write the consumer implementation**

`src/shared/messaging/rabbitmq/rabbitmq-consumer.ts`:
```typescript
import type { ILogger } from '@/shared/logger';
import type { ConsumeMessage } from 'amqplib';
import type { IMessageConsumer, MessageHandler } from '../message-broker.interface';
import type { RabbitMqConnection } from './rabbitmq-connection';
import { TOPOLOGY, type TopologyOptions, assertTopology } from './topology';

export interface ConsumerOptions extends TopologyOptions {
  /** Max delivery attempts before a message is parked. */
  maxAttempts: number;
  /** Unacked-message window. Defaults to 10. */
  prefetch?: number;
}

/** Reads the retry count from the x-death header (0 on first delivery). */
function readAttempt(msg: ConsumeMessage): number {
  const xDeath = msg.properties.headers?.['x-death'] as Array<{ count?: number }> | undefined;
  if (!xDeath || xDeath.length === 0) return 0;
  return Number(xDeath[0]?.count ?? 0);
}

export class RabbitMqConsumer implements IMessageConsumer {
  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly opts: ConsumerOptions,
    private readonly logger: ILogger,
  ) {}

  async start<T>(handler: MessageHandler<T>): Promise<void> {
    const channel = await this.connection.getChannel();
    await assertTopology(channel, { retryDelayMs: this.opts.retryDelayMs });
    await channel.prefetch(this.opts.prefetch ?? 10);

    await channel.consume(TOPOLOGY.queue, async (msg) => {
      if (!msg) return;
      const attempt = readAttempt(msg);

      let payload: T;
      try {
        payload = JSON.parse(msg.content.toString()) as T;
      } catch (err) {
        this.logger.error({ err }, 'Unparseable message, sending to parking-lot');
        this.park(channel, msg);
        channel.ack(msg);
        return;
      }

      let result: 'ack' | 'retry' | 'reject';
      try {
        result = await handler({ routingKey: msg.fields.routingKey, payload, attempt });
      } catch (err) {
        this.logger.error({ err, routingKey: msg.fields.routingKey }, 'Handler threw, will retry');
        result = 'retry';
      }

      if (result === 'ack') {
        channel.ack(msg);
        return;
      }

      if (result === 'reject') {
        this.park(channel, msg);
        channel.ack(msg);
        return;
      }

      // retry
      if (attempt >= this.opts.maxAttempts) {
        this.logger.warn({ attempt, routingKey: msg.fields.routingKey }, 'Attempts exhausted, parking');
        this.park(channel, msg);
        channel.ack(msg);
        return;
      }
      // requeue=false -> message dead-letters to the DLX -> retry queue (TTL delay).
      channel.nack(msg, false, false);
    });

    this.logger.info({ queue: TOPOLOGY.queue }, 'Consumer started');
  }

  private park(channel: Awaited<ReturnType<RabbitMqConnection['getChannel']>>, msg: ConsumeMessage): void {
    channel.sendToQueue(TOPOLOGY.parkingLot, msg.content, { persistent: true });
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx jest --config jest.unit.config.js src/shared/messaging/__tests__/rabbitmq-consumer.test.ts --runInBand
```
Expected: PASS — 6 tests green.

- [ ] **Step 5: Add the barrel and run lint**

Create `src/shared/messaging/index.ts`:
```typescript
export type {
  IMessagePublisher,
  IMessageConsumer,
  BrokerMessage,
  MessageHandler,
  ConsumeResult,
} from './message-broker.interface';
export {
  ROUTING_KEYS,
  MESSAGE_SCHEMA_VERSION,
  type RoutingKey,
  type SubscriptionCreatedMessage,
  type NewReleaseDetectedMessage,
  type NotificationWireMessage,
  type ReleaseSubscriber,
} from './messaging.contract';
export { RabbitMqConnection } from './rabbitmq/rabbitmq-connection';
export { RabbitMqPublisher } from './rabbitmq/rabbitmq-publisher';
export { RabbitMqConsumer, type ConsumerOptions } from './rabbitmq/rabbitmq-consumer';
export { TOPOLOGY, RETRY_DELAY_MS, type TopologyOptions } from './rabbitmq/topology';
```

Run:
```bash
npm run lint
```
Expected: biome clean; depcruise reports 0 violations (messaging imports only `@/shared/*` + `amqplib`).

- [ ] **Step 6: Commit**

```bash
git add src/shared/messaging
git commit -m "feat(hw7): rabbitmq consumer with retry/parking-lot logic + tests"
```

---

## Task 7: Notification consumer handler (with tests — graded logic)

Maps a parsed wire message to `NotificationService` calls. This is the notification-service-side consumer logic.

**Files:**
- Create: `src/services/notification/consumer.ts`
- Test: `src/services/notification/__tests__/consumer.test.ts`

- [ ] **Step 1: Write the failing test**

`src/services/notification/__tests__/consumer.test.ts`:
```typescript
import type { BrokerMessage } from '@/shared/messaging';
import { ROUTING_KEYS, type NotificationWireMessage } from '@/shared/messaging';
import type { NotificationService } from '../internal/notification.service';
import { buildNotificationConsumerHandler } from '../consumer';

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
    expect(service.sendReleaseNotification).toHaveBeenNthCalledWith(1, 'a@b.c', 'u1', 'golang/go', release);
    expect(service.sendReleaseNotification).toHaveBeenNthCalledWith(2, 'd@e.f', 'u2', 'golang/go', release);
    expect(result).toBe('ack');
  });

  it('returns reject for an unknown routing key', async () => {
    const handler = buildNotificationConsumerHandler(service);
    const result = await handler(msg('unknown.key', { v: 1, email: 'a@b.c', repo: 'x', confirmToken: 't' }));
    expect(result).toBe('reject');
    expect(service.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('returns retry when the service throws', async () => {
    service.sendConfirmationEmail.mockRejectedValueOnce(new Error('smtp down'));
    const handler = buildNotificationConsumerHandler(service);
    const result = await handler(
      msg(ROUTING_KEYS.SUBSCRIPTION_CREATED, { v: 1, email: 'a@b.c', repo: 'x', confirmToken: 't' }),
    );
    expect(result).toBe('retry');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx jest --config jest.unit.config.js src/services/notification/__tests__/consumer.test.ts --runInBand
```
Expected: FAIL — cannot find module `../consumer`.

- [ ] **Step 3: Write the handler**

`src/services/notification/consumer.ts`:
```typescript
import type { BrokerMessage, ConsumeResult, NotificationWireMessage } from '@/shared/messaging';
import { ROUTING_KEYS } from '@/shared/messaging';
import type { NotificationService } from './internal/notification.service';

/**
 * Builds the consumer handler that maps a parsed wire message to the
 * NotificationService. Returns 'ack' on success, 'retry' on a transient
 * service failure, 'reject' for an unroutable message (sent to parking-lot).
 */
export function buildNotificationConsumerHandler(service: NotificationService) {
  return async (msg: BrokerMessage<NotificationWireMessage>): Promise<ConsumeResult> => {
    try {
      if (msg.routingKey === ROUTING_KEYS.SUBSCRIPTION_CREATED) {
        const p = msg.payload as Extract<NotificationWireMessage, { confirmToken: string }>;
        await service.sendConfirmationEmail(p.email, p.confirmToken, p.repo);
        return 'ack';
      }
      if (msg.routingKey === ROUTING_KEYS.RELEASE_DETECTED) {
        const p = msg.payload as Extract<NotificationWireMessage, { subscribers: unknown[] }>;
        for (const sub of p.subscribers) {
          await service.sendReleaseNotification(sub.email, sub.unsubscribeToken, p.repo, p.release);
        }
        return 'ack';
      }
      return 'reject';
    } catch {
      return 'retry';
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx jest --config jest.unit.config.js src/services/notification/__tests__/consumer.test.ts --runInBand
```
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/notification/consumer.ts src/services/notification/__tests__/consumer.test.ts
git commit -m "feat(hw7): notification consumer handler mapping wire messages to email + tests"
```

---

## Task 8: BrokerEventPublisher in the main service (with tests)

Subscribes to the in-process bus and republishes the two domain events as wire messages.

**Files:**
- Create: `src/composition/broker-event-publisher.ts`
- Test: `src/composition/__tests__/broker-event-publisher.test.ts`

- [ ] **Step 1: Write the failing test**

`src/composition/__tests__/broker-event-publisher.test.ts`:
```typescript
import { NEW_RELEASE_DETECTED, SUBSCRIPTION_CREATED } from '@/shared/events';
import type { NewReleaseDetectedEvent, SubscriptionCreatedEvent } from '@/shared/events';
import type { IMessagePublisher } from '@/shared/messaging';
import { ROUTING_KEYS } from '@/shared/messaging';
import { BrokerEventPublisher } from '../broker-event-publisher';

const publisher = { publish: jest.fn().mockResolvedValue(undefined), close: jest.fn() } as unknown as jest.Mocked<IMessagePublisher>;

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
      v: 1,
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
      v: 1,
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx jest --config jest.unit.config.js src/composition/__tests__/broker-event-publisher.test.ts --runInBand
```
Expected: FAIL — cannot find module `../broker-event-publisher`.

- [ ] **Step 3: Write the publisher**

`src/composition/broker-event-publisher.ts`:
```typescript
import type { IEventBus } from '@/shared/events';
import {
  NEW_RELEASE_DETECTED,
  type NewReleaseDetectedEvent,
  SUBSCRIPTION_CREATED,
  type SubscriptionCreatedEvent,
} from '@/shared/events';
import type { IMessagePublisher } from '@/shared/messaging';
import { MESSAGE_SCHEMA_VERSION, ROUTING_KEYS } from '@/shared/messaging';

/**
 * Bridges the in-process event bus to the broker. Subscribed to the same two
 * domain events the old NotificationHandlers consumed; instead of an RPC call
 * it maps each event to a versioned wire message and publishes to RabbitMQ.
 */
export class BrokerEventPublisher {
  constructor(private readonly publisher: IMessagePublisher) {}

  async onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void> {
    await this.publisher.publish(ROUTING_KEYS.SUBSCRIPTION_CREATED, {
      v: MESSAGE_SCHEMA_VERSION,
      email: event.email,
      repo: event.repoSlug,
      confirmToken: event.confirmToken,
    });
  }

  async onNewReleaseDetected(event: NewReleaseDetectedEvent): Promise<void> {
    await this.publisher.publish(ROUTING_KEYS.RELEASE_DETECTED, {
      v: MESSAGE_SCHEMA_VERSION,
      repo: event.repoSlug,
      release: event.release,
      subscribers: event.subscribers,
    });
  }
}

export function registerBrokerEventPublisher(bus: IEventBus, pub: BrokerEventPublisher): void {
  bus.subscribe<SubscriptionCreatedEvent>(SUBSCRIPTION_CREATED, (e) => pub.onSubscriptionCreated(e));
  bus.subscribe<NewReleaseDetectedEvent>(NEW_RELEASE_DETECTED, (e) => pub.onNewReleaseDetected(e));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx jest --config jest.unit.config.js src/composition/__tests__/broker-event-publisher.test.ts --runInBand
```
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/composition/broker-event-publisher.ts src/composition/__tests__/broker-event-publisher.test.ts
git commit -m "feat(hw7): broker event publisher bridging in-process bus to rabbitmq + tests"
```

---

## Task 9: Config — add RabbitMQ URL + retry tunables

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/config/notification-env.ts`

- [ ] **Step 1: Add `rabbitmqUrl` to the main config interface and loader**

In `src/config/env.ts`, add to the `Config` interface (after `redisUrl`):
```typescript
  rabbitmqUrl: string;
```
And in `loadConfig()` return object (after the `redisUrl` line):
```typescript
    rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
```

- [ ] **Step 2: Update the notification config**

In `src/config/notification-env.ts`:

Replace `redisUrl: string;` in the interface with:
```typescript
  rabbitmqUrl: string;
  retryDelayMs: number;
  maxAttempts: number;
```
In `loadNotificationConfig()` return object, remove the `redisUrl: requireEnv('REDIS_URL'),` line and add:
```typescript
    rabbitmqUrl: requireEnv('RABBITMQ_URL'),
    retryDelayMs: Number(process.env.NOTIF_RETRY_DELAY_MS) || 5000,
    maxAttempts: Number(process.env.NOTIF_MAX_ATTEMPTS) || 3,
```

- [ ] **Step 3: Update the notification-env test**

Open `src/config/__tests__/notification-env.test.ts`. Replace any assertion/setup referencing `REDIS_URL` / `redisUrl` with `RABBITMQ_URL` / `rabbitmqUrl`. If the test sets `process.env.REDIS_URL` in setup, change it to `process.env.RABBITMQ_URL = 'amqp://localhost:5672'`. Add an assertion:
```typescript
    expect(config.rabbitmqUrl).toBe('amqp://localhost:5672');
    expect(config.maxAttempts).toBe(3);
```

- [ ] **Step 4: Run the config test**

Run:
```bash
npx jest --config jest.unit.config.js src/config/__tests__/notification-env.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/notification-env.ts src/config/__tests__/notification-env.test.ts
git commit -m "feat(hw7): add RABBITMQ_URL and retry tunables to config"
```

---

## Task 10: Wire RabbitMQ into the notification service; remove BullMQ

**Files:**
- Modify: `src/services/notification/container.ts`
- Modify: `src/services/notification/main.ts`
- Modify: `src/services/notification/http/server.ts`
- Delete: `src/services/notification/ingress.service.ts`, `src/services/notification/__tests__/ingress.service.test.ts`
- Delete: `src/services/notification/internal/notification.worker.ts`, `src/services/notification/internal/__tests__/notification.worker.test.ts`
- Delete: `src/services/notification/internal/notification.queue.ts`
- Delete: `src/services/notification/grpc/notification.server.ts` (confirm unused first)

- [ ] **Step 1: Rewrite the notification container**

Replace `src/services/notification/container.ts` with:
```typescript
import type { NotificationServiceConfig } from '@/config/notification-env';
import type { ILogger } from '@/shared/logger';
import { METRIC_DEFINITIONS, PrometheusMetricsCollector } from '@/shared/metrics';
import { RabbitMqConnection, RabbitMqConsumer } from '@/shared/messaging';
import { buildNotificationConsumerHandler } from './consumer';
import { MockEmailProvider } from './internal/mock-email.provider';
import { NotificationService } from './internal/notification.service';
import { ResendEmailProvider } from './internal/resend.provider';

export interface NotificationGraph {
  metrics: PrometheusMetricsCollector;
  consumer: RabbitMqConsumer;
  start: () => Promise<void>;
  close: () => Promise<void>;
}

export function buildNotificationGraph(
  config: NotificationServiceConfig,
  logger: ILogger,
): NotificationGraph {
  const metrics = new PrometheusMetricsCollector(METRIC_DEFINITIONS, {
    defaultMetricsPrefix: 'notif_',
  });
  const emailProvider =
    config.emailProvider === 'mock'
      ? new MockEmailProvider(config.emailMockUrl, config.emailFrom, logger.child({ component: 'mock-email' }))
      : new ResendEmailProvider(config.resendApiKey, config.emailFrom, logger.child({ component: 'resend' }));
  const service = new NotificationService(
    emailProvider,
    config.baseUrl,
    metrics,
    logger.child({ component: 'service' }),
  );
  const connection = new RabbitMqConnection(config.rabbitmqUrl, logger.child({ component: 'rabbitmq' }));
  const consumer = new RabbitMqConsumer(
    connection,
    { retryDelayMs: config.retryDelayMs, maxAttempts: config.maxAttempts },
    logger.child({ component: 'consumer' }),
  );
  const handler = buildNotificationConsumerHandler(service);

  return {
    metrics,
    consumer,
    start: () => consumer.start(handler),
    close: () => consumer.close(),
  };
}
```

- [ ] **Step 2: Reduce the HTTP server to a healthcheck**

Replace `src/services/notification/http/server.ts` with:
```typescript
import type { ILogger } from '@/shared/logger';
import Fastify, { type FastifyInstance } from 'fastify';

export interface NotificationHttpDeps {
  logger: ILogger;
}

/** Liveness/readiness only — the notification service now consumes from the broker. */
export async function buildNotificationHttpServer(_deps: NotificationHttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/healthz', async () => ({ status: 'ok' }));
  return app;
}
```

- [ ] **Step 3: Rewrite the notification entrypoint**

Replace `src/services/notification/main.ts` with:
```typescript
import 'reflect-metadata';
import { loadNotificationConfig } from '@/config/notification-env';
import { PinoLogger } from '@/shared/logger';
import { buildNotificationGraph } from './container';
import { buildNotificationHttpServer } from './http/server';

async function main() {
  const config = loadNotificationConfig();
  const logger = PinoLogger.create({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    pretty: config.nodeEnv === 'development',
    base: { service: 'notification-service', env: config.nodeEnv },
  });

  logger.info('Starting notification service...');
  const graph = buildNotificationGraph(config, logger);

  const http = await buildNotificationHttpServer({ logger });
  await http.listen({ port: config.notificationHttpPort, host: '0.0.0.0' });
  logger.info({ port: config.notificationHttpPort }, 'Notification HTTP healthcheck listening');

  await graph.start();
  logger.info('Notification consumer started');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Notification service shutting down');
    await http.close();
    await graph.close();
    logger.info('Notification service shut down gracefully');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error during notification service startup:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Confirm gRPC ingress is unused, then delete obsolete files**

Run:
```bash
npx tsc --noEmit
```
This will report every reference to the now-removed exports. Then delete:
```bash
git rm src/services/notification/ingress.service.ts \
       src/services/notification/__tests__/ingress.service.test.ts \
       src/services/notification/internal/notification.worker.ts \
       src/services/notification/internal/__tests__/notification.worker.test.ts \
       src/services/notification/internal/notification.queue.ts \
       src/services/notification/grpc/notification.server.ts
```
Also delete the HTTP server test that asserts the old ingress endpoints if it no longer applies:
```bash
git rm src/services/notification/__tests__/http.server.test.ts
```
(If you prefer to keep an HTTP test, rewrite it to assert `GET /healthz` returns `{status:'ok'}` instead of deleting.)

- [ ] **Step 5: Re-run tsc until clean**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. Fix any remaining import of deleted modules (e.g. `schema.ts` if only used by the removed routes — delete it too if orphaned).

- [ ] **Step 6: Run the notification service unit tests**

Run:
```bash
npx jest --config jest.unit.config.js src/services/notification --runInBand
```
Expected: PASS (consumer test + notification.service test + resend.provider test).

- [ ] **Step 7: Commit**

```bash
git add -A src/services/notification
git commit -m "refactor(hw7): notification service consumes from rabbitmq, drop bullmq + http/grpc ingress"
```

---

## Task 11: Wire RabbitMQ into the main service; remove RPC client module

**Files:**
- Modify: `src/infrastructure/infra.module.ts`
- Modify: `src/composition/container.ts`
- Delete: `src/modules/notifications/` (entire directory)

- [ ] **Step 1: Register a RabbitMQ connection instance in infra**

In `src/infrastructure/infra.module.ts`:

Add a token after `EVENT_BUS`:
```typescript
export const RABBITMQ: InjectionToken<RabbitMqConnection> = Symbol('RABBITMQ');
```
Add the import at the top:
```typescript
import { RabbitMqConnection } from '@/shared/messaging';
```
In `createInfraInstances`, after creating `bullmq`, add:
```typescript
  const rabbitmq = new RabbitMqConnection(config.rabbitmqUrl, logger.child({ component: 'rabbitmq' }));
```
and return it:
```typescript
  return { prisma, redis, bullmq, rabbitmq };
```

- [ ] **Step 2: Rewire the composition root**

In `src/composition/container.ts`:

Remove the `@/modules/notifications` import block and the lines that resolve `NOTIFICATION_CLIENT`, build `NotificationHandlers`, and call `registerNotificationHandlers`.

Add imports:
```typescript
import { RETRY_DELAY_MS, RabbitMqPublisher } from '@/shared/messaging';
import { BrokerEventPublisher, registerBrokerEventPublisher } from './broker-event-publisher';
```
(Export `RETRY_DELAY_MS` from `src/shared/messaging/index.ts` — add it to the `topology.ts` re-export line.)
Destructure `rabbitmq` from `createInfraInstances` and register it:
```typescript
  const { prisma, redis, bullmq, rabbitmq } = await createInfraInstances(config, rootLogger);
  c.registerInstance(PRISMA, prisma);
  c.registerInstance(REDIS, redis);
  c.registerInstance(BULLMQ, bullmq);
  c.registerInstance(RABBITMQ, rabbitmq);
```
(Add `RABBITMQ` to the infra-module import list.)

Replace the notification-handler wiring with:
```typescript
  const brokerPublisher = new RabbitMqPublisher(
    rabbitmq,
    { retryDelayMs: RETRY_DELAY_MS },
    rootLogger.child({ component: 'rabbitmq-publisher' }),
  );
  registerBrokerEventPublisher(eventBus, new BrokerEventPublisher(brokerPublisher));
```

> The publisher and consumer both assert the topology, so they must pass the same `retryDelayMs`. The shared `RETRY_DELAY_MS` constant (added in Task 3) is the single source of truth: the main publisher uses it directly here; the notification consumer defaults its `retryDelayMs` config to it (Task 9 already reads `NOTIF_RETRY_DELAY_MS` which defaults to `5000` — keep that default equal to `RETRY_DELAY_MS`).

Update `BuiltGraph` to expose what shutdown needs. Add to the interface:
```typescript
  brokerPublisher: RabbitMqPublisher;
```
and to the returned object:
```typescript
    brokerPublisher,
```
Remove `notificationClient` from `BuiltGraph` and the return (it no longer exists).

- [ ] **Step 3: Update shutdown / main to close the publisher**

Find where `BuiltGraph` is consumed on shutdown (search `notificationClient` and `bullmq.close`):
```bash
grep -rn "notificationClient\|\.close()" src/main.ts src/app.ts src/composition
```
Wherever the graph is torn down, add `await graph.brokerPublisher.close();` and remove any `graph.notificationClient` reference.

- [ ] **Step 4: Delete the RPC client module**

```bash
git rm -r src/modules/notifications
```

- [ ] **Step 5: Run tsc and fix references**

Run:
```bash
npx tsc --noEmit
```
Expected: errors only where deleted `@/modules/notifications` exports were imported (e.g. `container.ts` if a leftover import remains, or `infra.module.test.ts`). Fix each: remove the import / assertion. Re-run until clean.

- [ ] **Step 6: Run the full unit suite**

Run:
```bash
npx jest --config jest.unit.config.js --runInBand
```
Expected: PASS. Update/delete any test that asserted the old notification-client wiring (e.g. an `infra.module.test.ts` or container test referencing `NOTIFICATION_CLIENT`). If a container test exists asserting handler registration, rewrite it to assert `registerBrokerEventPublisher` was wired (or delete if it tested the removed RPC path).

- [ ] **Step 7: Run lint (boundaries)**

Run:
```bash
npm run lint
```
Expected: 0 depcruise violations. `BrokerEventPublisher` is under `composition/` (may import anything); `shared/messaging` imports only `shared` + `amqplib`. If a `no-orphans` warning appears for a deleted-module leftover, remove the orphan.

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "refactor(hw7): main service publishes events to rabbitmq, remove RPC notification clients"
```

---

## Task 12: Docker Compose + env

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Add the rabbitmq service**

In `docker-compose.yml`, add under `services:`:
```yaml
  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - '${RABBITMQ_PORT:-5672}:5672'
      - '${RABBITMQ_UI_PORT:-15672}:15672'
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-guest}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS:-guest}
    healthcheck:
      test: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
```

- [ ] **Step 2: Point both services at rabbitmq**

In the `app` service `environment:`, add:
```yaml
      RABBITMQ_URL: ${DOCKER_RABBITMQ_URL:-amqp://guest:guest@rabbitmq:5672}
```
In the `app` service `depends_on:`, add:
```yaml
      rabbitmq:
        condition: service_healthy
```

In the `notification` service `environment:`, remove the `REDIS_URL` line and add:
```yaml
      RABBITMQ_URL: ${DOCKER_RABBITMQ_URL:-amqp://guest:guest@rabbitmq:5672}
      NOTIF_RETRY_DELAY_MS: ${NOTIF_RETRY_DELAY_MS:-5000}
      NOTIF_MAX_ATTEMPTS: ${NOTIF_MAX_ATTEMPTS:-3}
```
Replace the `notification` service `depends_on:` block (was `notif-redis`) with:
```yaml
    depends_on:
      rabbitmq:
        condition: service_healthy
```

- [ ] **Step 3: Remove the notif-redis service and volume**

Delete the entire `notif-redis:` service block and the `notif_redis_data:` entry under `volumes:`.

- [ ] **Step 4: Update `.env.example`**

Add:
```
RABBITMQ_URL=amqp://guest:guest@localhost:5672
NOTIF_RETRY_DELAY_MS=5000
NOTIF_MAX_ATTEMPTS=3
```

- [ ] **Step 5: Validate compose syntax**

Run:
```bash
docker compose config >/dev/null && echo OK
```
Expected: prints `OK` (no YAML/interpolation errors).

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore(hw7): add rabbitmq to docker-compose, drop notif-redis"
```

---

## Task 13: End-to-end smoke (manual, dockerized)

**Files:** none (verification only)

- [ ] **Step 1: Build and start the stack**

Run:
```bash
docker compose up -d --build
```
Expected: `rabbitmq` becomes healthy; `app` and `notification` start.

- [ ] **Step 2: Watch the notification consumer connect**

Run:
```bash
docker compose logs -f notification | head -n 40
```
Expected: log lines `RabbitMQ connected` and `Consumer started`.

- [ ] **Step 3: Trigger a subscription**

Hit the subscribe endpoint (use the real route from `src/modules/subscriptions/subscription.routes.ts`; adjust path/body):
```bash
curl -s -X POST http://localhost:3000/api/subscriptions \
  -H 'content-type: application/json' \
  -d '{"email":"test@example.com","repo":"golang/go"}'
```
Expected: success response; notification logs show a confirmation email send attempt (or mock-email POST if `EMAIL_PROVIDER=mock`).

- [ ] **Step 4: Inspect RabbitMQ management UI**

Open `http://localhost:15672` (guest/guest). Confirm the `notifications` exchange and the `notifications.email`, `notifications.retry`, `notifications.parking-lot` queues exist.

- [ ] **Step 5: Tear down**

Run:
```bash
docker compose down
```

- [ ] **Step 6: Commit (if any compose fixes were needed)**

```bash
git add -A
git commit -m "chore(hw7): docker smoke fixes" || echo "nothing to commit"
```

---

## Task 14: ADR + docs

**Files:**
- Create: `docs/adr/00X-rabbitmq-message-broker.md` (use the next ADR number — check `docs/adr/`)

- [ ] **Step 1: Find the next ADR number**

Run:
```bash
ls docs/adr/
```
Pick the next sequential number.

- [ ] **Step 2: Write the ADR**

Create `docs/adr/00X-rabbitmq-message-broker.md`:
```markdown
# ADR 00X: RabbitMQ message broker between services

## Status
Accepted (HW7, 2026-06-19)

## Context
The main service and the extracted notification service communicated over a
synchronous HTTP/gRPC RPC hop (HW6). This coupled the two services: a slow or
down notification service blocked or failed user-facing subscribe/scan paths.
HW7 requires a real message broker and an event consumer in the notification
service.

## Decision
- Use **RabbitMQ** (topic exchange) as the inter-service broker.
- Keep the in-process `IEventBus` as-is for local fan-out; add a separate
  `IMessagePublisher`/`IMessageConsumer` abstraction for the network broker.
  One interface cannot honestly model both synchronous local fan-out (which
  aggregates handler errors) and fire-and-forget network delivery.
- Publish **events** (`subscription.created`, `release.detected`), not commands.
- Retry/backoff via a **dead-letter exchange + TTL retry queue**; exhausted and
  poison messages go to a **parking-lot** queue. No plugins (stock RabbitMQ).
- **Remove BullMQ from the notification service** — RabbitMQ + DLX covers both
  transport and retry, and the notification service no longer needs Redis. The
  scanner's BullMQ in the main service is unaffected.

## Consequences
- Services are decoupled; the main service no longer waits on notification.
- Delivery is at-least-once: a retried message may send a duplicate email.
  Accepted for this project; an idempotency key + dedupe store is the future fix.
- One more piece of infrastructure (RabbitMQ) to run.

## Alternatives considered
- **Redis Streams:** reuses existing Redis but is a weaker fit for the
  "Message Broker" pattern and consumer-group semantics here.
- **Kafka:** heavier (KRaft/ZooKeeper), overkill for this volume.
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/
git commit -m "docs(hw7): ADR for rabbitmq message broker"
```

---

## Task 15: Final gate

- [ ] **Step 1: Full lint + unit tests**

Run:
```bash
npm run lint && npx jest --config jest.unit.config.js --runInBand
```
Expected: biome clean, 0 depcruise violations, all unit suites pass.

- [ ] **Step 2: Build**

Run:
```bash
npm run build
```
Expected: `tsc` + `tsc-alias` succeed, no type errors.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin hw7-message-bus-message-broker
```

---

## Notes for the implementer

- **Shared retry-delay constant:** the publisher and consumer both call `assertTopology`, which sets the retry queue's `messageTtl`. Both must pass the same `retryDelayMs` or RabbitMQ will reject the queue redeclaration with a `PRECONDITION_FAILED` (inequivalent args). Task 11 Step 2 introduces a shared `RETRY_DELAY_MS` constant in `topology.ts` — use it on both sides.
- **`amqplib` type names** vary slightly across 0.10.x patch versions (`ChannelModel` vs `Connection`). Trust `npx tsc --noEmit` and adjust the type import in `rabbitmq-connection.ts` if needed.
- **at-least-once:** duplicate emails on retry are expected and documented; do not add dedup in this plan (YAGNI / out of scope).
- **Do not touch the scanner's BullMQ** in the main service — it is unrelated to this change.
```