# HW8 — Orchestrated Saga Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a distributed transaction across the monolith (orchestrator) and the notification service (participant) for the subscribe flow, using an orchestrated Saga backed by a transactional outbox; the confirmation email either succeeds or the subscription is compensated (hard-deleted).

**Architecture:** `subscribe()` writes subscription + saga instance + outbox row in ONE Postgres transaction (no dual-write). A polling relay publishes the outbox command to a dedicated `saga.commands` exchange. The notification service consumes the command, sends the email, and publishes a result to `saga.replies`. A monolith reply consumer marks the saga COMPLETED or compensates (DELETE subscription). A timeout sweeper compensates sagas stuck in STARTED.

**Tech Stack:** TypeScript, Fastify, Prisma/PostgreSQL, amqplib (RabbitMQ), tsyringe DI, Jest (Docker-run via `npm run test:unit`), Biome + dependency-cruiser.

---

## Architectural constraints (read first)

dependency-cruiser enforces these — violating them fails `npm run lint`:

- **`shared/**` must not import `modules/**`.** Therefore the outbox (`src/shared/outbox/`) is **generic**: it stores/relays `{exchange, routingKey, payload}` and knows nothing about sagas.
- **`services/**` are isolated from `modules/**` and `shared/**`-owned-by-modules.** The notification service may import only from `src/shared/**`. Therefore the **saga wire contract (command + reply types, routing keys, exchange names) lives in `src/shared/messaging/saga.contract.ts`** so both processes share it over the wire.
- The existing `RabbitMqPublisher` / `RabbitMqConsumer` / `assertTopology` **hardcode the HW7 `notifications` exchange/queue** (`TOPOLOGY.exchange`, `TOPOLOGY.queue`). They cannot be reused for saga traffic. This plan adds a dedicated `SagaBroker` with its own topology. The HW7 messaging code is left untouched.

## File structure

**New — shared (wire contract + generic outbox):**

```text
src/shared/messaging/saga.contract.ts        SAGA_EXCHANGES, SAGA_ROUTING_KEYS, SAGA_SCHEMA_VERSION, command/reply types
src/shared/outbox/outbox.repository.interface.ts   IOutboxRepository, OutboxRecord, NewOutboxMessage
src/shared/outbox/outbox.repository.ts        Prisma OutboxRepository (tx-aware enqueue)
src/shared/outbox/outbox-relay.ts             OutboxRelay (poll -> publish -> markSent)
src/shared/outbox/index.ts                    barrel
src/shared/outbox/__tests__/outbox-relay.test.ts
```

**New — saga module (monolith orchestrator):**

```text
src/modules/saga/saga-broker.ts               SagaBroker: own topology, publishCommand(), consumeReplies(), publishReply()*  (*publishReply used by notif via shared, see Task 9)
src/modules/saga/saga.topology.ts             assertSagaTopology(channel)
src/modules/saga/saga.repository.interface.ts ISagaRepository, SagaRecord
src/modules/saga/saga.repository.ts           Prisma SagaRepository (tx-aware create)
src/modules/saga/confirmation-saga.ts         ConfirmationSaga: start(), handleReply(), sweepTimeouts()
src/modules/saga/saga.module.ts               DI tokens + registration
src/modules/saga/index.ts                     barrel
src/modules/saga/__tests__/confirmation-saga.test.ts
```

**New — composition:**

```text
src/composition/saga-reply-consumer.ts        wires SagaBroker reply stream -> ConfirmationSaga.handleReply
```

**New — notification service:**

```text
src/services/notification/saga-consumer.ts    buildSagaCommandHandler(service) -> sends email, returns reply intent
src/services/notification/saga-broker.ts      notif-side broker: consume saga.commands, publish saga.replies
src/services/notification/__tests__/saga-consumer.test.ts
```

**Modified:**

```text
prisma/schema.prisma                          + SagaInstance, OutboxMessage models
src/config/env.ts                             + outboxPollMs, outboxMaxAttempts, sagaTimeoutMs, sagaSweepMs
src/modules/subscriptions/subscription.repository.interface.ts   create() accepts tx client
src/modules/subscriptions/subscription.repository.ts            create() accepts tx client
src/modules/subscriptions/subscription.service.ts              subscribe() uses $transaction; no event publish
src/modules/subscriptions/subscriptions.module.ts             inject PRISMA + saga/outbox repos into service
src/composition/broker-event-publisher.ts     remove onSubscriptionCreated + its subscription
src/composition/container.ts                  register saga module, start relay + sweeper + reply consumer
src/services/notification/container.ts        wire saga command consumer + reply publisher
src/shared/messaging/index.ts                 export saga.contract
src/shared/outbox/                            (new, see above)
docs/adr/012-orchestrated-saga-outbox.md      ADR
```

---

## Task 1: Saga wire contract (shared)

**Files:**
- Create: `src/shared/messaging/saga.contract.ts`
- Test: `src/shared/messaging/__tests__/saga.contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/messaging/__tests__/saga.contract.test.ts
import {
  SAGA_EXCHANGES,
  SAGA_ROUTING_KEYS,
  SAGA_SCHEMA_VERSION,
  type SendConfirmationCommand,
  type ConfirmationResultReply,
} from '../saga.contract';

describe('saga.contract', () => {
  it('defines the two saga exchanges', () => {
    expect(SAGA_EXCHANGES.commands).toBe('saga.commands');
    expect(SAGA_EXCHANGES.replies).toBe('saga.replies');
  });

  it('defines command and reply routing keys', () => {
    expect(SAGA_ROUTING_KEYS.sendConfirmation).toBe('saga.send-confirmation');
    expect(SAGA_ROUTING_KEYS.confirmationResult).toBe('saga.confirmation-result');
  });

  it('command and reply carry the schema version and sagaId', () => {
    const cmd: SendConfirmationCommand = {
      v: SAGA_SCHEMA_VERSION,
      sagaId: 's1',
      email: 'a@b.c',
      confirmToken: 'tok',
      repo: 'golang/go',
    };
    const reply: ConfirmationResultReply = { v: SAGA_SCHEMA_VERSION, sagaId: 's1', success: true };
    expect(cmd.sagaId).toBe('s1');
    expect(reply.sagaId).toBe('s1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- saga.contract`
Expected: FAIL — cannot find module `../saga.contract`.

- [ ] **Step 3: Write the contract**

```ts
// src/shared/messaging/saga.contract.ts

/** Dedicated exchanges for the orchestrated saga; separate from the HW7 `notifications` exchange. */
export const SAGA_EXCHANGES = {
  commands: 'saga.commands',
  replies: 'saga.replies',
} as const;

export const SAGA_ROUTING_KEYS = {
  sendConfirmation: 'saga.send-confirmation',
  confirmationResult: 'saga.confirmation-result',
} as const;

/** Bump on a breaking saga payload change. */
export const SAGA_SCHEMA_VERSION = 1 as const;

/** Command: orchestrator -> notification service. */
export interface SendConfirmationCommand {
  v: typeof SAGA_SCHEMA_VERSION;
  sagaId: string;
  email: string;
  confirmToken: string;
  repo: string;
}

/** Reply: notification service -> orchestrator. */
export interface ConfirmationResultReply {
  v: typeof SAGA_SCHEMA_VERSION;
  sagaId: string;
  success: boolean;
  error?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- saga.contract`
Expected: PASS.

- [ ] **Step 5: Export from messaging barrel**

Add to `src/shared/messaging/index.ts`:

```ts
export {
  SAGA_EXCHANGES,
  SAGA_ROUTING_KEYS,
  SAGA_SCHEMA_VERSION,
  type SendConfirmationCommand,
  type ConfirmationResultReply,
} from './saga.contract';
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/messaging/saga.contract.ts src/shared/messaging/__tests__/saga.contract.test.ts src/shared/messaging/index.ts
git commit -m "feat(saga): add saga wire contract (commands, replies, exchanges)"
```

---

## Task 2: Prisma models + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_saga_outbox/migration.sql` (generated)

- [ ] **Step 1: Add models to schema**

Append to `prisma/schema.prisma`:

```prisma
model SagaInstance {
  id             String   @id @default(uuid())
  type           String
  status         String
  subscriptionId String   @map("subscription_id")
  email          String
  repoSlug       String   @map("repo_slug")
  lastError      String?  @map("last_error")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@index([status])
  @@map("saga_instances")
}

model OutboxMessage {
  id         String    @id @default(uuid())
  sagaId     String    @map("saga_id")
  exchange   String
  routingKey String    @map("routing_key")
  payload    Json
  status     String    @default("PENDING")
  attempts   Int       @default(0)
  createdAt  DateTime  @default(now()) @map("created_at")
  sentAt     DateTime? @map("sent_at")

  @@index([status, createdAt])
  @@map("outbox_messages")
}
```

- [ ] **Step 2: Create the migration + regenerate client**

Run: `npm run db:migrate -- --name add_saga_outbox`
Expected: a new migration folder under `prisma/migrations/` and `@prisma/client` types regenerated to include `SagaInstance` and `OutboxMessage`.

(If no local DB is available, run `npx prisma migrate dev --create-only --name add_saga_outbox` then `npm run db:generate`.)

- [ ] **Step 3: Verify the client typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — `prisma.sagaInstance` and `prisma.outboxMessage` are typed.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(saga): add SagaInstance and OutboxMessage models + migration"
```

---

## Task 3: Outbox repository (generic, shared)

**Files:**
- Create: `src/shared/outbox/outbox.repository.interface.ts`
- Create: `src/shared/outbox/outbox.repository.ts`
- Create: `src/shared/outbox/index.ts`
- Test: `src/shared/outbox/__tests__/outbox.repository.test.ts`

- [ ] **Step 1: Write the interface**

```ts
// src/shared/outbox/outbox.repository.interface.ts
import type { Prisma, PrismaClient } from '@prisma/client';

/** A Prisma client or an interactive-transaction client. */
export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface NewOutboxMessage {
  sagaId: string;
  exchange: string;
  routingKey: string;
  payload: unknown;
}

export interface OutboxRecord {
  id: string;
  sagaId: string;
  exchange: string;
  routingKey: string;
  payload: unknown;
  attempts: number;
}

export interface IOutboxRepository {
  /** Insert a PENDING message. Pass a tx client to enlist in a transaction. */
  enqueue(msg: NewOutboxMessage, tx?: PrismaLike): Promise<void>;
  findPending(limit: number): Promise<OutboxRecord[]>;
  markSent(id: string): Promise<void>;
  bumpAttempts(id: string): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/shared/outbox/__tests__/outbox.repository.test.ts
import { OutboxRepository } from '../outbox.repository';

function fakePrisma() {
  return {
    outboxMessage: {
      create: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('OutboxRepository', () => {
  it('enqueue uses the passed tx client when provided', async () => {
    const prisma = fakePrisma();
    const tx = fakePrisma();
    const repo = new OutboxRepository(prisma as never);
    await repo.enqueue(
      { sagaId: 's1', exchange: 'saga.commands', routingKey: 'k', payload: { a: 1 } },
      tx as never,
    );
    expect(tx.outboxMessage.create).toHaveBeenCalledWith({
      data: { sagaId: 's1', exchange: 'saga.commands', routingKey: 'k', payload: { a: 1 } },
    });
    expect(prisma.outboxMessage.create).not.toHaveBeenCalled();
  });

  it('findPending returns PENDING ordered by createdAt with a limit', async () => {
    const prisma = fakePrisma();
    prisma.outboxMessage.findMany.mockResolvedValue([
      { id: 'o1', sagaId: 's1', exchange: 'e', routingKey: 'k', payload: {}, attempts: 0 },
    ]);
    const repo = new OutboxRepository(prisma as never);
    const rows = await repo.findPending(10);
    expect(prisma.outboxMessage.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    expect(rows[0].id).toBe('o1');
  });

  it('markSent sets status SENT and sentAt', async () => {
    const prisma = fakePrisma();
    const repo = new OutboxRepository(prisma as never);
    await repo.markSent('o1');
    expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: 'SENT', sentAt: expect.any(Date) },
    });
  });

  it('bumpAttempts increments attempts', async () => {
    const prisma = fakePrisma();
    const repo = new OutboxRepository(prisma as never);
    await repo.bumpAttempts('o1');
    expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { attempts: { increment: 1 } },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- outbox.repository`
Expected: FAIL — cannot find module `../outbox.repository`.

- [ ] **Step 4: Write the implementation**

```ts
// src/shared/outbox/outbox.repository.ts
import type { PrismaClient } from '@prisma/client';
import type {
  IOutboxRepository,
  NewOutboxMessage,
  OutboxRecord,
  PrismaLike,
} from './outbox.repository.interface';

export class OutboxRepository implements IOutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueue(msg: NewOutboxMessage, tx?: PrismaLike): Promise<void> {
    const client = tx ?? this.prisma;
    await client.outboxMessage.create({
      data: {
        sagaId: msg.sagaId,
        exchange: msg.exchange,
        routingKey: msg.routingKey,
        // Prisma Json column accepts a plain object.
        payload: msg.payload as never,
      },
    });
  }

  async findPending(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      sagaId: r.sagaId,
      exchange: r.exchange,
      routingKey: r.routingKey,
      payload: r.payload,
      attempts: r.attempts,
    }));
  }

  async markSent(id: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  async bumpAttempts(id: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }
}
```

- [ ] **Step 5: Write the barrel**

```ts
// src/shared/outbox/index.ts
export type {
  IOutboxRepository,
  NewOutboxMessage,
  OutboxRecord,
  PrismaLike,
} from './outbox.repository.interface';
export { OutboxRepository } from './outbox.repository';
export { OutboxRelay } from './outbox-relay';
```

(`outbox-relay` is created in Task 4; the export line will resolve then. If running Task 3 in isolation, temporarily omit the last line and add it in Task 4.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:unit -- outbox.repository`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/outbox/outbox.repository.ts src/shared/outbox/outbox.repository.interface.ts src/shared/outbox/index.ts src/shared/outbox/__tests__/outbox.repository.test.ts
git commit -m "feat(outbox): add generic transactional outbox repository"
```

---

## Task 4: Outbox relay (polling publisher)

**Files:**
- Create: `src/shared/outbox/outbox-relay.ts`
- Test: `src/shared/outbox/__tests__/outbox-relay.test.ts`

The relay depends only on a minimal publish function `(exchange, routingKey, payload) => Promise<void>` — keeping `shared/outbox` free of any RabbitMQ/saga import.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/outbox/__tests__/outbox-relay.test.ts
import { OutboxRelay } from '../outbox-relay';
import type { IOutboxRepository, OutboxRecord } from '../outbox.repository.interface';

function rec(id: string): OutboxRecord {
  return { id, sagaId: 's1', exchange: 'saga.commands', routingKey: 'k', payload: { a: 1 }, attempts: 0 };
}

function repoWith(pending: OutboxRecord[]): jest.Mocked<IOutboxRepository> {
  return {
    enqueue: jest.fn(),
    findPending: jest.fn().mockResolvedValue(pending),
    markSent: jest.fn().mockResolvedValue(undefined),
    bumpAttempts: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IOutboxRepository>;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => logger } as never;

describe('OutboxRelay.drainOnce', () => {
  it('publishes each pending row then marks it SENT', async () => {
    const repo = repoWith([rec('o1')]);
    const publish = jest.fn().mockResolvedValue(undefined);
    const relay = new OutboxRelay(repo, publish, { batchSize: 10, maxAttempts: 5 }, logger);
    await relay.drainOnce();
    expect(publish).toHaveBeenCalledWith('saga.commands', 'k', { a: 1 });
    expect(repo.markSent).toHaveBeenCalledWith('o1');
  });

  it('leaves the row PENDING and bumps attempts when publish throws', async () => {
    const repo = repoWith([rec('o1')]);
    const publish = jest.fn().mockRejectedValue(new Error('rabbit down'));
    const relay = new OutboxRelay(repo, publish, { batchSize: 10, maxAttempts: 5 }, logger);
    await relay.drainOnce();
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.bumpAttempts).toHaveBeenCalledWith('o1');
  });

  it('does nothing when there are no pending rows', async () => {
    const repo = repoWith([]);
    const publish = jest.fn();
    const relay = new OutboxRelay(repo, publish, { batchSize: 10, maxAttempts: 5 }, logger);
    await relay.drainOnce();
    expect(publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- outbox-relay`
Expected: FAIL — cannot find module `../outbox-relay`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/outbox/outbox-relay.ts
import type { ILogger } from '@/shared/logger';
import type { IOutboxRepository } from './outbox.repository.interface';

export type PublishFn = (exchange: string, routingKey: string, payload: unknown) => Promise<void>;

export interface OutboxRelayOptions {
  batchSize: number;
  maxAttempts: number;
}

/**
 * Polls the outbox for PENDING rows and publishes them. At-least-once: a row is
 * marked SENT only after a successful publish, so a crash between publish and
 * markSent yields a duplicate publish (consumers must tolerate duplicates).
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: IOutboxRepository,
    private readonly publish: PublishFn,
    private readonly opts: OutboxRelayOptions,
    private readonly logger: ILogger,
  ) {}

  async drainOnce(): Promise<void> {
    const pending = await this.repo.findPending(this.opts.batchSize);
    for (const row of pending) {
      try {
        await this.publish(row.exchange, row.routingKey, row.payload);
        await this.repo.markSent(row.id);
      } catch (err) {
        await this.repo.bumpAttempts(row.id);
        if (row.attempts + 1 >= this.opts.maxAttempts) {
          this.logger.error(
            { id: row.id, attempts: row.attempts + 1 },
            'Outbox row exceeded max publish attempts; staying PENDING for manual review',
          );
        } else {
          this.logger.warn({ err, id: row.id }, 'Outbox publish failed; will retry next poll');
        }
      }
    }
  }

  start(intervalMs: number): void {
    this.timer = setInterval(() => {
      void this.drainOnce();
    }, intervalMs);
    this.logger.info({ intervalMs }, 'Outbox relay started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- outbox-relay`
Expected: PASS.

- [ ] **Step 5: Ensure barrel exports the relay**

Confirm `src/shared/outbox/index.ts` includes `export { OutboxRelay } from './outbox-relay';` (added in Task 3).

- [ ] **Step 6: Commit**

```bash
git add src/shared/outbox/outbox-relay.ts src/shared/outbox/__tests__/outbox-relay.test.ts src/shared/outbox/index.ts
git commit -m "feat(outbox): add polling relay with at-least-once publish"
```

---

## Task 5: Saga topology + broker (monolith)

**Files:**
- Create: `src/modules/saga/saga.topology.ts`
- Create: `src/modules/saga/saga-broker.ts`
- Test: `src/modules/saga/__tests__/saga.topology.test.ts`

- [ ] **Step 1: Write the failing test (topology declares both exchanges and queues)**

```ts
// src/modules/saga/__tests__/saga.topology.test.ts
import { assertSagaTopology, SAGA_QUEUES } from '../saga.topology';

function fakeChannel() {
  return {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
  };
}

describe('assertSagaTopology', () => {
  it('declares the commands + replies exchanges and binds both queues', async () => {
    const ch = fakeChannel();
    await assertSagaTopology(ch as never);
    expect(ch.assertExchange).toHaveBeenCalledWith('saga.commands', 'direct', { durable: true });
    expect(ch.assertExchange).toHaveBeenCalledWith('saga.replies', 'direct', { durable: true });
    expect(ch.assertQueue).toHaveBeenCalledWith(SAGA_QUEUES.commands, expect.objectContaining({ durable: true }));
    expect(ch.assertQueue).toHaveBeenCalledWith(SAGA_QUEUES.replies, expect.objectContaining({ durable: true }));
    expect(ch.bindQueue).toHaveBeenCalledWith(SAGA_QUEUES.commands, 'saga.commands', 'saga.send-confirmation');
    expect(ch.bindQueue).toHaveBeenCalledWith(SAGA_QUEUES.replies, 'saga.replies', 'saga.confirmation-result');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- saga.topology`
Expected: FAIL — cannot find module `../saga.topology`.

- [ ] **Step 3: Write the topology**

```ts
// src/modules/saga/saga.topology.ts
import type { Channel } from 'amqplib';
import { SAGA_EXCHANGES, SAGA_ROUTING_KEYS } from '@/shared/messaging';

export const SAGA_QUEUES = {
  commands: 'saga.commands.confirmation',
  replies: 'saga.replies.confirmation',
} as const;

/** Idempotent declaration of the saga command + reply exchanges and queues. */
export async function assertSagaTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(SAGA_EXCHANGES.commands, 'direct', { durable: true });
  await channel.assertExchange(SAGA_EXCHANGES.replies, 'direct', { durable: true });

  await channel.assertQueue(SAGA_QUEUES.commands, { durable: true });
  await channel.bindQueue(SAGA_QUEUES.commands, SAGA_EXCHANGES.commands, SAGA_ROUTING_KEYS.sendConfirmation);

  await channel.assertQueue(SAGA_QUEUES.replies, { durable: true });
  await channel.bindQueue(SAGA_QUEUES.replies, SAGA_EXCHANGES.replies, SAGA_ROUTING_KEYS.confirmationResult);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- saga.topology`
Expected: PASS.

- [ ] **Step 5: Write the broker (thin amqp wrapper, reuses RabbitMqConnection)**

```ts
// src/modules/saga/saga-broker.ts
import type { ILogger } from '@/shared/logger';
import type { ConfirmationResultReply, SendConfirmationCommand } from '@/shared/messaging';
import { SAGA_EXCHANGES, SAGA_ROUTING_KEYS } from '@/shared/messaging';
import { RabbitMqConnection } from '@/shared/messaging';
import { SAGA_QUEUES, assertSagaTopology } from './saga.topology';

export class SagaBroker {
  private asserted = false;

  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly logger: ILogger,
  ) {}

  private async ready() {
    const channel = await this.connection.getChannel();
    if (!this.asserted) {
      await assertSagaTopology(channel);
      this.asserted = true;
    }
    return channel;
  }

  /** Used by the outbox relay's PublishFn. */
  async publishCommand(routingKey: string, payload: unknown): Promise<void> {
    const channel = await this.ready();
    channel.publish(SAGA_EXCHANGES.commands, routingKey, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      contentType: 'application/json',
    });
    this.logger.debug({ routingKey }, 'Saga command published');
  }

  /** Consume replies; invokes handler with the parsed reply. Auto-acks on resolve. */
  async consumeReplies(handler: (reply: ConfirmationResultReply) => Promise<void>): Promise<void> {
    const channel = await this.ready();
    await channel.consume(SAGA_QUEUES.replies, async (msg) => {
      if (!msg) return;
      try {
        const reply = JSON.parse(msg.content.toString()) as ConfirmationResultReply;
        await handler(reply);
        channel.ack(msg);
      } catch (err) {
        this.logger.error({ err }, 'Failed to process saga reply; requeueing once');
        channel.nack(msg, false, false);
      }
    });
    this.logger.info({ queue: SAGA_QUEUES.replies }, 'Saga reply consumer started');
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
```

Note: `RabbitMqConnection` is exported from `@/shared/messaging` (see its `index.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/saga/saga.topology.ts src/modules/saga/saga-broker.ts src/modules/saga/__tests__/saga.topology.test.ts
git commit -m "feat(saga): add saga topology and broker (commands + replies)"
```

---

## Task 6: Saga repository

**Files:**
- Create: `src/modules/saga/saga.repository.interface.ts`
- Create: `src/modules/saga/saga.repository.ts`
- Test: `src/modules/saga/__tests__/saga.repository.test.ts`

- [ ] **Step 1: Write the interface**

```ts
// src/modules/saga/saga.repository.interface.ts
import type { PrismaLike } from '@/shared/outbox';

export interface NewSagaInstance {
  id: string;
  type: string;
  subscriptionId: string;
  email: string;
  repoSlug: string;
}

export interface SagaRecord {
  id: string;
  status: string;
  subscriptionId: string;
  email: string;
  repoSlug: string;
}

export interface ISagaRepository {
  /** Insert a STARTED instance. Pass a tx client to enlist in a transaction. */
  create(data: NewSagaInstance, tx?: PrismaLike): Promise<void>;
  findById(id: string): Promise<SagaRecord | null>;
  updateStatus(id: string, status: string, lastError?: string): Promise<void>;
  /** STARTED instances older than `before`. */
  findStaleStarted(before: Date): Promise<SagaRecord[]>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/modules/saga/__tests__/saga.repository.test.ts
import { SagaRepository } from '../saga.repository';

function fakePrisma() {
  return {
    sagaInstance: {
      create: jest.fn().mockResolvedValue(undefined),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('SagaRepository', () => {
  it('create inserts a STARTED instance on the tx client', async () => {
    const prisma = fakePrisma();
    const tx = fakePrisma();
    const repo = new SagaRepository(prisma as never);
    await repo.create(
      { id: 's1', type: 'confirmation', subscriptionId: 'sub1', email: 'a@b.c', repoSlug: 'x/y' },
      tx as never,
    );
    expect(tx.sagaInstance.create).toHaveBeenCalledWith({
      data: {
        id: 's1',
        type: 'confirmation',
        status: 'STARTED',
        subscriptionId: 'sub1',
        email: 'a@b.c',
        repoSlug: 'x/y',
      },
    });
  });

  it('updateStatus writes status and lastError', async () => {
    const prisma = fakePrisma();
    const repo = new SagaRepository(prisma as never);
    await repo.updateStatus('s1', 'COMPENSATED', 'email failed');
    expect(prisma.sagaInstance.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'COMPENSATED', lastError: 'email failed' },
    });
  });

  it('findStaleStarted queries STARTED older than the cutoff', async () => {
    const prisma = fakePrisma();
    const repo = new SagaRepository(prisma as never);
    const cutoff = new Date('2026-06-20T00:00:00Z');
    await repo.findStaleStarted(cutoff);
    expect(prisma.sagaInstance.findMany).toHaveBeenCalledWith({
      where: { status: 'STARTED', createdAt: { lt: cutoff } },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- saga.repository`
Expected: FAIL — cannot find module `../saga.repository`.

- [ ] **Step 4: Write the implementation**

```ts
// src/modules/saga/saga.repository.ts
import type { PrismaClient } from '@prisma/client';
import type { PrismaLike } from '@/shared/outbox';
import type {
  ISagaRepository,
  NewSagaInstance,
  SagaRecord,
} from './saga.repository.interface';

export class SagaRepository implements ISagaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: NewSagaInstance, tx?: PrismaLike): Promise<void> {
    const client = tx ?? this.prisma;
    await client.sagaInstance.create({
      data: {
        id: data.id,
        type: data.type,
        status: 'STARTED',
        subscriptionId: data.subscriptionId,
        email: data.email,
        repoSlug: data.repoSlug,
      },
    });
  }

  async findById(id: string): Promise<SagaRecord | null> {
    const row = await this.prisma.sagaInstance.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      subscriptionId: row.subscriptionId,
      email: row.email,
      repoSlug: row.repoSlug,
    };
  }

  async updateStatus(id: string, status: string, lastError?: string): Promise<void> {
    await this.prisma.sagaInstance.update({
      where: { id },
      data: { status, lastError },
    });
  }

  async findStaleStarted(before: Date): Promise<SagaRecord[]> {
    const rows = await this.prisma.sagaInstance.findMany({
      where: { status: 'STARTED', createdAt: { lt: before } },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      subscriptionId: row.subscriptionId,
      email: row.email,
      repoSlug: row.repoSlug,
    }));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- saga.repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/saga/saga.repository.ts src/modules/saga/saga.repository.interface.ts src/modules/saga/__tests__/saga.repository.test.ts
git commit -m "feat(saga): add saga instance repository"
```

---

## Task 7: ConfirmationSaga orchestrator

**Files:**
- Create: `src/modules/saga/confirmation-saga.ts`
- Test: `src/modules/saga/__tests__/confirmation-saga.test.ts`

The orchestrator owns: starting a saga inside a caller-provided transaction, handling a reply (complete or compensate), and the timeout sweep. It depends on `ISagaRepository`, `IOutboxRepository`, a compensation callback `(subscriptionId) => Promise<void>` (delete subscription — keeps saga free of a `modules/subscriptions` import, avoiding a cross-module cycle), and a `generateId` function.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/saga/__tests__/confirmation-saga.test.ts
import { ConfirmationSaga } from '../confirmation-saga';
import type { ISagaRepository, SagaRecord } from '../saga.repository.interface';
import type { IOutboxRepository } from '@/shared/outbox';
import { SAGA_EXCHANGES, SAGA_ROUTING_KEYS, SAGA_SCHEMA_VERSION } from '@/shared/messaging';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => logger } as never;

function sagaRepo(): jest.Mocked<ISagaRepository> {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(null),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    findStaleStarted: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<ISagaRepository>;
}
function outboxRepo(): jest.Mocked<IOutboxRepository> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    findPending: jest.fn(),
    markSent: jest.fn(),
    bumpAttempts: jest.fn(),
  } as unknown as jest.Mocked<IOutboxRepository>;
}
function record(over: Partial<SagaRecord> = {}): SagaRecord {
  return { id: 's1', status: 'STARTED', subscriptionId: 'sub1', email: 'a@b.c', repoSlug: 'x/y', ...over };
}

describe('ConfirmationSaga', () => {
  it('start creates the instance and enqueues the command on the same tx', async () => {
    const saga = sagaRepo();
    const outbox = outboxRepo();
    const compensate = jest.fn();
    const orch = new ConfirmationSaga(saga, outbox, compensate, () => 's1', 60000, logger);
    const tx = {} as never;

    await orch.start({ subscriptionId: 'sub1', email: 'a@b.c', repoSlug: 'x/y', confirmToken: 'tok' }, tx);

    expect(saga.create).toHaveBeenCalledWith(
      { id: 's1', type: 'confirmation', subscriptionId: 'sub1', email: 'a@b.c', repoSlug: 'x/y' },
      tx,
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      {
        sagaId: 's1',
        exchange: SAGA_EXCHANGES.commands,
        routingKey: SAGA_ROUTING_KEYS.sendConfirmation,
        payload: { v: SAGA_SCHEMA_VERSION, sagaId: 's1', email: 'a@b.c', confirmToken: 'tok', repo: 'x/y' },
      },
      tx,
    );
  });

  it('handleReply success marks the saga COMPLETED', async () => {
    const saga = sagaRepo();
    saga.findById.mockResolvedValue(record());
    const orch = new ConfirmationSaga(saga, outboxRepo(), jest.fn(), () => 's1', 60000, logger);
    await orch.handleReply({ v: 1, sagaId: 's1', success: true });
    expect(saga.updateStatus).toHaveBeenCalledWith('s1', 'COMPLETED', undefined);
  });

  it('handleReply failure compensates and marks COMPENSATED', async () => {
    const saga = sagaRepo();
    saga.findById.mockResolvedValue(record());
    const compensate = jest.fn().mockResolvedValue(undefined);
    const orch = new ConfirmationSaga(saga, outboxRepo(), compensate, () => 's1', 60000, logger);
    await orch.handleReply({ v: 1, sagaId: 's1', success: false, error: 'smtp down' });
    expect(compensate).toHaveBeenCalledWith('sub1');
    expect(saga.updateStatus).toHaveBeenCalledWith('s1', 'COMPENSATED', 'smtp down');
  });

  it('handleReply is a no-op when the saga is already terminal (duplicate reply)', async () => {
    const saga = sagaRepo();
    saga.findById.mockResolvedValue(record({ status: 'COMPLETED' }));
    const compensate = jest.fn();
    const orch = new ConfirmationSaga(saga, outboxRepo(), compensate, () => 's1', 60000, logger);
    await orch.handleReply({ v: 1, sagaId: 's1', success: false });
    expect(compensate).not.toHaveBeenCalled();
    expect(saga.updateStatus).not.toHaveBeenCalled();
  });

  it('handleReply marks FAILED when compensation throws', async () => {
    const saga = sagaRepo();
    saga.findById.mockResolvedValue(record());
    const compensate = jest.fn().mockRejectedValue(new Error('db gone'));
    const orch = new ConfirmationSaga(saga, outboxRepo(), compensate, () => 's1', 60000, logger);
    await orch.handleReply({ v: 1, sagaId: 's1', success: false, error: 'smtp down' });
    expect(saga.updateStatus).toHaveBeenCalledWith('s1', 'FAILED', expect.stringContaining('db gone'));
  });

  it('sweepTimeouts compensates stale STARTED sagas', async () => {
    const saga = sagaRepo();
    saga.findStaleStarted.mockResolvedValue([record()]);
    const compensate = jest.fn().mockResolvedValue(undefined);
    const orch = new ConfirmationSaga(saga, outboxRepo(), compensate, () => 's1', 60000, logger);
    await orch.sweepTimeouts(new Date());
    expect(compensate).toHaveBeenCalledWith('sub1');
    expect(saga.updateStatus).toHaveBeenCalledWith('s1', 'COMPENSATED', 'timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- confirmation-saga`
Expected: FAIL — cannot find module `../confirmation-saga`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/saga/confirmation-saga.ts
import type { ILogger } from '@/shared/logger';
import type { IOutboxRepository, PrismaLike } from '@/shared/outbox';
import {
  type ConfirmationResultReply,
  SAGA_EXCHANGES,
  SAGA_ROUTING_KEYS,
  SAGA_SCHEMA_VERSION,
  type SendConfirmationCommand,
} from '@/shared/messaging';
import type { ISagaRepository } from './saga.repository.interface';

export interface StartConfirmationInput {
  subscriptionId: string;
  email: string;
  repoSlug: string;
  confirmToken: string;
}

/** Deletes the subscription row; injected to avoid a saga -> subscriptions import. */
export type CompensateFn = (subscriptionId: string) => Promise<void>;

const TERMINAL = new Set(['COMPLETED', 'COMPENSATED', 'FAILED']);

export class ConfirmationSaga {
  constructor(
    private readonly sagas: ISagaRepository,
    private readonly outbox: IOutboxRepository,
    private readonly compensate: CompensateFn,
    private readonly generateId: () => string,
    private readonly timeoutMs: number,
    private readonly logger: ILogger,
  ) {}

  /** Step 1, inside the caller's transaction: record the saga + enqueue the command. */
  async start(input: StartConfirmationInput, tx: PrismaLike): Promise<string> {
    const sagaId = this.generateId();
    await this.sagas.create(
      {
        id: sagaId,
        type: 'confirmation',
        subscriptionId: input.subscriptionId,
        email: input.email,
        repoSlug: input.repoSlug,
      },
      tx,
    );
    const command: SendConfirmationCommand = {
      v: SAGA_SCHEMA_VERSION,
      sagaId,
      email: input.email,
      confirmToken: input.confirmToken,
      repo: input.repoSlug,
    };
    await this.outbox.enqueue(
      {
        sagaId,
        exchange: SAGA_EXCHANGES.commands,
        routingKey: SAGA_ROUTING_KEYS.sendConfirmation,
        payload: command,
      },
      tx,
    );
    return sagaId;
  }

  async handleReply(reply: ConfirmationResultReply): Promise<void> {
    const saga = await this.sagas.findById(reply.sagaId);
    if (!saga) {
      this.logger.warn({ sagaId: reply.sagaId }, 'Reply for unknown saga; ignoring');
      return;
    }
    if (TERMINAL.has(saga.status)) {
      this.logger.info({ sagaId: reply.sagaId, status: saga.status }, 'Duplicate reply; ignoring');
      return;
    }

    if (reply.success) {
      await this.sagas.updateStatus(saga.id, 'COMPLETED', undefined);
      this.logger.info({ sagaId: saga.id }, 'Saga completed');
      return;
    }

    await this.compensateSaga(saga.id, saga.subscriptionId, reply.error ?? 'unknown error');
  }

  async sweepTimeouts(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - this.timeoutMs);
    const stale = await this.sagas.findStaleStarted(cutoff);
    for (const saga of stale) {
      this.logger.warn({ sagaId: saga.id }, 'Saga timed out; compensating');
      await this.compensateSaga(saga.id, saga.subscriptionId, 'timeout');
    }
  }

  private async compensateSaga(id: string, subscriptionId: string, reason: string): Promise<void> {
    try {
      await this.compensate(subscriptionId);
      await this.sagas.updateStatus(id, 'COMPENSATED', reason);
      this.logger.info({ sagaId: id }, 'Saga compensated');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.sagas.updateStatus(id, 'FAILED', `compensation failed: ${message}`);
      this.logger.error({ sagaId: id, err }, 'Compensation failed; saga FAILED');
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- confirmation-saga`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/saga/confirmation-saga.ts src/modules/saga/__tests__/confirmation-saga.test.ts
git commit -m "feat(saga): add ConfirmationSaga orchestrator (start, reply, sweep)"
```

---

## Task 8: subscribe() — single transaction, no event publish

**Files:**
- Modify: `src/modules/subscriptions/subscription.repository.interface.ts`
- Modify: `src/modules/subscriptions/subscription.repository.ts`
- Modify: `src/modules/subscriptions/subscription.service.ts`
- Test: `src/modules/subscriptions/__tests__/subscription.service.test.ts` (add/extend)

- [ ] **Step 1: Make `create` tx-aware in the interface**

In `subscription.repository.interface.ts`, change the `create` signature and import `PrismaLike`:

```ts
import type { PrismaLike } from '@/shared/outbox';
// ...
  create(data: {
    email: string;
    repoId: string;
    confirmToken: string;
    unsubscribeToken: string;
  }, tx?: PrismaLike): Promise<Subscription>;
```

- [ ] **Step 2: Make `create` tx-aware in the implementation**

In `subscription.repository.ts`:

```ts
import type { PrismaLike } from '@/shared/outbox';
// ...
  async create(
    data: { email: string; repoId: string; confirmToken: string; unsubscribeToken: string },
    tx?: PrismaLike,
  ): Promise<Subscription> {
    const client = tx ?? this.prisma;
    return client.subscription.create({ data });
  }
```

- [ ] **Step 3: Write the failing test for subscribe()**

```ts
// src/modules/subscriptions/__tests__/subscription.service.test.ts  (new or extended)
import { SubscriptionService } from '../subscription.service';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => logger } as never;

describe('SubscriptionService.subscribe (saga)', () => {
  it('creates subscription and starts the saga in one transaction, no event published', async () => {
    const created = { id: 'sub1', email: 'a@b.c', repoId: 'r1', confirmToken: 'ctok', unsubscribeToken: 'utok' };
    const subRepo = {
      findByEmailAndRepo: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(created),
    };
    const repoRepo = { findOrCreate: jest.fn().mockResolvedValue({ id: 'r1', owner: 'x', name: 'y' }) };
    const github = { verifyRepo: jest.fn().mockResolvedValue(undefined) };
    const validator = {
      assertEmail: jest.fn(),
      parseSlug: jest.fn().mockReturnValue({ owner: 'x', name: 'y' }),
    };
    const events = { publish: jest.fn() };
    const saga = { start: jest.fn().mockResolvedValue('s1') };
    // prisma.$transaction(cb) runs cb with a tx client (here, a sentinel).
    const tx = { __tx: true };
    const prisma = { $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };

    const service = new SubscriptionService(
      subRepo as never, repoRepo as never, github as never, events as never,
      validator as never, prisma as never, saga as never, logger,
    );

    await service.subscribe('a@b.c', 'x/y');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(subRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.c', repoId: 'r1' }),
      tx,
    );
    expect(saga.start).toHaveBeenCalledWith(
      { subscriptionId: 'sub1', email: 'a@b.c', repoSlug: 'x/y', confirmToken: 'ctok' },
      tx,
    );
    expect(events.publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:unit -- subscription.service`
Expected: FAIL — `SubscriptionService` constructor arity / `subscribe` does not use `$transaction`.

- [ ] **Step 5: Rewrite subscribe() to use a transaction + saga**

Replace `subscription.service.ts` constructor and `subscribe`/`createSubscriptionRow` (drop the event-bus publish; keep `events` only if other methods still use it — they do not, so remove the `IEventBus` dependency):

```ts
import type { IGitHubService } from '@/modules/github';
import { ConflictError, NotFoundError } from '@/shared/errors/app-error';
import type { ILogger } from '@/shared/logger';
import { generateToken } from '@/shared/utils/token';
import type { PrismaClient, Repo } from '@prisma/client';
import { toSubscriptionResponses } from './subscription.mapper';
import type { IRepoRepository, ISubscriptionRepository } from './subscription.repository.interface';
import type { SubscriptionResponse } from './subscription.types';
import type { SubscriptionValidator } from './subscription.validator';

/** Minimal saga surface the service needs (avoids importing the concrete class). */
export interface IConfirmationSagaStarter {
  start(
    input: { subscriptionId: string; email: string; repoSlug: string; confirmToken: string },
    tx: unknown,
  ): Promise<string>;
}

export class SubscriptionService {
  constructor(
    private readonly repo: ISubscriptionRepository,
    private readonly repoRepo: IRepoRepository,
    private readonly githubService: IGitHubService,
    private readonly validator: SubscriptionValidator,
    private readonly prisma: PrismaClient,
    private readonly saga: IConfirmationSagaStarter,
    private readonly logger: ILogger,
  ) {}

  async subscribe(email: string, repoSlug: string): Promise<void> {
    this.validator.assertEmail(email);
    const { owner, name } = this.validator.parseSlug(repoSlug);
    const repoRecord = await this.ensureRepoExists(owner, name);
    await this.assertNotDuplicate(email, repoRecord.id);

    const confirmToken = generateToken();
    const unsubscribeToken = generateToken();

    await this.prisma.$transaction(async (tx) => {
      const subscription = await this.repo.create(
        { email, repoId: repoRecord.id, confirmToken, unsubscribeToken },
        tx,
      );
      await this.saga.start(
        { subscriptionId: subscription.id, email, repoSlug, confirmToken },
        tx,
      );
    });

    this.logger.info({ email, repo: repoSlug }, 'Subscription created, confirmation saga started');
  }

  // confirm(), unsubscribe(), getSubscriptions(), ensureRepoExists(),
  // assertNotDuplicate() are UNCHANGED from the current file — keep them verbatim.
}
```

Keep `confirm`, `unsubscribe`, `getSubscriptions`, `ensureRepoExists`, `assertNotDuplicate` exactly as they are now (copy from the existing file). Remove the `IEventBus`/`SUBSCRIPTION_CREATED` imports and the `createSubscriptionRow` helper.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:unit -- subscription.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/subscriptions/subscription.service.ts src/modules/subscriptions/subscription.repository.ts src/modules/subscriptions/subscription.repository.interface.ts src/modules/subscriptions/__tests__/subscription.service.test.ts
git commit -m "feat(saga): subscribe() writes subscription + saga in one tx, drops event publish"
```

---

## Task 9: Notification-side saga consumer + reply publisher

**Files:**
- Create: `src/services/notification/saga-consumer.ts`
- Create: `src/services/notification/saga-broker.ts`
- Test: `src/services/notification/__tests__/saga-consumer.test.ts`

The notification service consumes `saga.send-confirmation`, calls `sendConfirmationEmail`, and returns a `ConfirmationResultReply` to publish. Only imports from `@/shared/**` (boundary-safe).

- [ ] **Step 1: Write the failing test (handler maps command -> email -> reply)**

```ts
// src/services/notification/__tests__/saga-consumer.test.ts
import { buildSagaCommandHandler } from '../saga-consumer';
import type { NotificationService } from '../internal/notification.service';
import { SAGA_SCHEMA_VERSION, type SendConfirmationCommand } from '@/shared/messaging';

const service = {
  sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<NotificationService>;

const cmd: SendConfirmationCommand = {
  v: SAGA_SCHEMA_VERSION, sagaId: 's1', email: 'a@b.c', confirmToken: 'tok', repo: 'x/y',
};

describe('buildSagaCommandHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the confirmation email and returns a success reply', async () => {
    const handler = buildSagaCommandHandler(service);
    const reply = await handler(cmd);
    expect(service.sendConfirmationEmail).toHaveBeenCalledWith('a@b.c', 'tok', 'x/y');
    expect(reply).toEqual({ v: SAGA_SCHEMA_VERSION, sagaId: 's1', success: true });
  });

  it('returns a failure reply with the error message when the email throws', async () => {
    service.sendConfirmationEmail.mockRejectedValueOnce(new Error('smtp down'));
    const handler = buildSagaCommandHandler(service);
    const reply = await handler(cmd);
    expect(reply).toEqual({ v: SAGA_SCHEMA_VERSION, sagaId: 's1', success: false, error: 'smtp down' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- saga-consumer`
Expected: FAIL — cannot find module `../saga-consumer`.

- [ ] **Step 3: Write the handler**

```ts
// src/services/notification/saga-consumer.ts
import {
  type ConfirmationResultReply,
  SAGA_SCHEMA_VERSION,
  type SendConfirmationCommand,
} from '@/shared/messaging';
import type { NotificationService } from './internal/notification.service';

/**
 * Maps a send-confirmation command to an email send and a reply. Never throws:
 * a failed email becomes a success:false reply so the orchestrator can compensate.
 */
export function buildSagaCommandHandler(service: NotificationService) {
  return async (cmd: SendConfirmationCommand): Promise<ConfirmationResultReply> => {
    try {
      await service.sendConfirmationEmail(cmd.email, cmd.confirmToken, cmd.repo);
      return { v: SAGA_SCHEMA_VERSION, sagaId: cmd.sagaId, success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { v: SAGA_SCHEMA_VERSION, sagaId: cmd.sagaId, success: false, error };
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- saga-consumer`
Expected: PASS.

- [ ] **Step 5: Write the notif-side broker (consume commands, publish replies)**

```ts
// src/services/notification/saga-broker.ts
import type { ILogger } from '@/shared/logger';
import {
  type ConfirmationResultReply,
  RabbitMqConnection,
  SAGA_EXCHANGES,
  SAGA_ROUTING_KEYS,
  type SendConfirmationCommand,
} from '@/shared/messaging';

const COMMANDS_QUEUE = 'saga.commands.confirmation';

/** Declares the same saga topology the orchestrator uses; idempotent. */
async function assertNotifSagaTopology(channel: Awaited<ReturnType<RabbitMqConnection['getChannel']>>) {
  await channel.assertExchange(SAGA_EXCHANGES.commands, 'direct', { durable: true });
  await channel.assertExchange(SAGA_EXCHANGES.replies, 'direct', { durable: true });
  await channel.assertQueue(COMMANDS_QUEUE, { durable: true });
  await channel.bindQueue(COMMANDS_QUEUE, SAGA_EXCHANGES.commands, SAGA_ROUTING_KEYS.sendConfirmation);
}

export class NotifSagaBroker {
  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly logger: ILogger,
  ) {}

  async start(handler: (cmd: SendConfirmationCommand) => Promise<ConfirmationResultReply>): Promise<void> {
    const channel = await this.connection.getChannel();
    await assertNotifSagaTopology(channel);
    await channel.prefetch(10);

    await channel.consume(COMMANDS_QUEUE, async (msg) => {
      if (!msg) return;
      try {
        const cmd = JSON.parse(msg.content.toString()) as SendConfirmationCommand;
        const reply = await handler(cmd);
        channel.publish(
          SAGA_EXCHANGES.replies,
          SAGA_ROUTING_KEYS.confirmationResult,
          Buffer.from(JSON.stringify(reply)),
          { persistent: true, contentType: 'application/json' },
        );
        channel.ack(msg);
      } catch (err) {
        // Unparseable / publish failure: nack without requeue (drop). The
        // orchestrator's timeout sweeper will compensate if no reply arrives.
        this.logger.error({ err }, 'Saga command processing failed; dropping');
        channel.nack(msg, false, false);
      }
    });
    this.logger.info({ queue: COMMANDS_QUEUE }, 'Saga command consumer started');
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/services/notification/saga-consumer.ts src/services/notification/saga-broker.ts src/services/notification/__tests__/saga-consumer.test.ts
git commit -m "feat(saga): notification service consumes saga commands, publishes replies"
```

---

## Task 10: Config + saga module DI

**Files:**
- Modify: `src/config/env.ts`
- Create: `src/modules/saga/saga.module.ts`
- Create: `src/modules/saga/index.ts`

- [ ] **Step 1: Add config fields**

In `src/config/env.ts`, extend `Config` and `loadConfig()`:

```ts
// interface Config — add:
  outboxPollMs: number;
  outboxMaxAttempts: number;
  outboxBatchSize: number;
  sagaTimeoutMs: number;
  sagaSweepMs: number;
```

```ts
// loadConfig() return — add:
    outboxPollMs: Number(process.env.OUTBOX_POLL_MS) || 2000,
    outboxMaxAttempts: Number(process.env.OUTBOX_MAX_ATTEMPTS) || 10,
    outboxBatchSize: Number(process.env.OUTBOX_BATCH_SIZE) || 20,
    sagaTimeoutMs: Number(process.env.SAGA_TIMEOUT_MS) || 60000,
    sagaSweepMs: Number(process.env.SAGA_SWEEP_MS) || 30000,
```

- [ ] **Step 2: Write the saga module (DI tokens + registration)**

```ts
// src/modules/saga/saga.module.ts
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { PRISMA } from '@/infrastructure/infra.module';
import type { Config } from '@/config/env';
import type { ILogger } from '@/shared/logger';
import { OutboxRepository } from '@/shared/outbox';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import { ConfirmationSaga, type CompensateFn } from './confirmation-saga';
import { SagaRepository } from './saga.repository';

export const SAGA_REPO: InjectionToken = Symbol('SAGA_REPO');
export const OUTBOX_REPO: InjectionToken = Symbol('OUTBOX_REPO');
export const CONFIRMATION_SAGA: InjectionToken<ConfirmationSaga> = Symbol('CONFIRMATION_SAGA');

/** `compensate` is supplied by the composition root (deletes the subscription). */
export function registerSagaModule(c: DependencyContainer, compensate: CompensateFn): void {
  c.register(SAGA_REPO, {
    useFactory: (dep) => new SagaRepository(dep.resolve<PrismaClient>(PRISMA)),
  });
  c.register(OUTBOX_REPO, {
    useFactory: (dep) => new OutboxRepository(dep.resolve<PrismaClient>(PRISMA)),
  });
  c.register(CONFIRMATION_SAGA, {
    useFactory: (dep) => {
      const config = dep.resolve<Config>(CONFIG);
      return new ConfirmationSaga(
        dep.resolve(SAGA_REPO),
        dep.resolve(OUTBOX_REPO),
        compensate,
        () => randomUUID(),
        config.sagaTimeoutMs,
        dep.resolve<ILogger>(ROOT_LOGGER).child({ module: 'saga' }),
      );
    },
  });
}
```

- [ ] **Step 3: Write the barrel**

```ts
// src/modules/saga/index.ts
export {
  registerSagaModule,
  SAGA_REPO,
  OUTBOX_REPO,
  CONFIRMATION_SAGA,
} from './saga.module';
export { ConfirmationSaga, type CompensateFn, type IConfirmationSagaStarter } from './confirmation-saga';
export { SagaBroker } from './saga-broker';
export { SAGA_QUEUES } from './saga.topology';
```

Note: `IConfirmationSagaStarter` is declared in `subscription.service.ts` (Task 8). If you prefer it shared, move the interface to `confirmation-saga.ts` and import it there too. For this plan, re-export from `confirmation-saga.ts` by also declaring it there:

```ts
// add to confirmation-saga.ts
export interface IConfirmationSagaStarter {
  start(
    input: { subscriptionId: string; email: string; repoSlug: string; confirmToken: string },
    tx: unknown,
  ): Promise<string>;
}
```

and in `subscription.service.ts` import it instead of redeclaring:

```ts
import type { IConfirmationSagaStarter } from '@/modules/saga';
```

(`ConfirmationSaga` structurally satisfies this interface.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/modules/saga/saga.module.ts src/modules/saga/index.ts src/modules/saga/confirmation-saga.ts src/modules/subscriptions/subscription.service.ts
git commit -m "feat(saga): add config + saga module DI wiring"
```

---

## Task 11: Monolith composition wiring

**Files:**
- Modify: `src/modules/subscriptions/subscriptions.module.ts`
- Modify: `src/composition/broker-event-publisher.ts`
- Create: `src/composition/saga-reply-consumer.ts`
- Modify: `src/composition/container.ts`

- [ ] **Step 1: Update subscriptions module DI to new service constructor**

In `subscriptions.module.ts`, the `SUBSCRIPTION_SERVICE` factory now needs `PRISMA` and `CONFIRMATION_SAGA` instead of `EVENT_BUS`:

```ts
import { PRISMA } from '@/infrastructure/infra.module';
import { CONFIRMATION_SAGA } from '@/modules/saga';
import type { PrismaClient } from '@prisma/client';
// ...
  c.register(SUBSCRIPTION_SERVICE, {
    useFactory: (dep) =>
      new SubscriptionService(
        dep.resolve(SUBSCRIPTION_REPO),
        dep.resolve(REPO_REPO),
        dep.resolve<IGitHubService>(GITHUB_SERVICE),
        dep.resolve(SUBSCRIPTION_VALIDATOR),
        dep.resolve<PrismaClient>(PRISMA),
        dep.resolve(CONFIRMATION_SAGA),
        dep.resolve<ILogger>(ROOT_LOGGER).child({ module: 'subscriptions' }),
      ),
  });
```

Remove the now-unused `EVENT_BUS` import if nothing else in the file uses it.

- [ ] **Step 2: Trim broker-event-publisher to release-only**

In `src/composition/broker-event-publisher.ts`, delete `onSubscriptionCreated` and its subscription; keep `onNewReleaseDetected`:

```ts
import type { IEventBus } from '@/shared/events';
import { NEW_RELEASE_DETECTED, type NewReleaseDetectedEvent } from '@/shared/events';
import type { IMessagePublisher } from '@/shared/messaging';
import { MESSAGE_SCHEMA_VERSION, ROUTING_KEYS } from '@/shared/messaging';

export class BrokerEventPublisher {
  constructor(private readonly publisher: IMessagePublisher) {}

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
  bus.subscribe<NewReleaseDetectedEvent>(NEW_RELEASE_DETECTED, (e) => pub.onNewReleaseDetected(e));
}
```

- [ ] **Step 3: Write the reply consumer wiring**

```ts
// src/composition/saga-reply-consumer.ts
import type { ConfirmationSaga, SagaBroker } from '@/modules/saga';

/** Subscribes the saga broker's reply stream to the orchestrator. */
export async function startSagaReplyConsumer(
  broker: SagaBroker,
  saga: ConfirmationSaga,
): Promise<void> {
  await broker.consumeReplies((reply) => saga.handleReply(reply));
}
```

- [ ] **Step 4: Wire everything in the container**

In `src/composition/container.ts`:

1. Import: `registerSagaModule`, `CONFIRMATION_SAGA`, `SagaBroker` from `@/modules/saga`; `OutboxRepository`, `OutboxRelay` from `@/shared/outbox`; `SUBSCRIPTION_REPO`, `ISubscriptionRepository` from `@/modules/subscriptions`; `startSagaReplyConsumer` from `./saga-reply-consumer`.
2. After `registerSubscriptionsModule(c)` but BEFORE resolving `SUBSCRIPTION_SERVICE`, register the saga module with a compensation closure that deletes the subscription:

```ts
// the compensation deletes the subscription row
registerSagaModule(c, async (subscriptionId: string) => {
  const subRepo = c.resolve<ISubscriptionRepository>(SUBSCRIPTION_REPO);
  await subRepo.deleteSubscription(subscriptionId);
});
```

Order note: `registerSubscriptionsModule` (which registers `SUBSCRIPTION_REPO`) must run before `registerSagaModule` so the compensation closure can resolve `SUBSCRIPTION_REPO`. The subscriptions `SUBSCRIPTION_SERVICE` factory resolves `CONFIRMATION_SAGA` lazily (factory runs on first resolve), so registering saga after subscriptions is fine.

3. Build the saga broker on its own RabbitMQ connection and start the relay + reply consumer + sweeper:

```ts
const sagaConnection = new RabbitMqConnection(
  config.rabbitmqUrl,
  rootLogger.child({ component: 'saga-rabbitmq' }),
);
const sagaBroker = new SagaBroker(sagaConnection, rootLogger.child({ component: 'saga-broker' }));
const confirmationSaga = c.resolve<ConfirmationSaga>(CONFIRMATION_SAGA);
const outboxRepo = new OutboxRepository(prisma);
const outboxRelay = new OutboxRelay(
  outboxRepo,
  (exchange, routingKey, payload) => sagaBroker.publishCommand(routingKey, payload),
  { batchSize: config.outboxBatchSize, maxAttempts: config.outboxMaxAttempts },
  rootLogger.child({ component: 'outbox-relay' }),
);
outboxRelay.start(config.outboxPollMs);
await startSagaReplyConsumer(sagaBroker, confirmationSaga);
const sagaSweeper = setInterval(() => {
  void confirmationSaga.sweepTimeouts(new Date());
}, config.sagaSweepMs);
```

4. Add to `BuiltGraph` and the returned object: `sagaBroker`, `outboxRelay`, `sagaSweeper`. Import `RabbitMqConnection`, `ConfirmationSaga` types as needed.

5. In `src/composition/shutdown.ts`, stop the relay, clear the sweeper, and close the saga broker:

```ts
graph.outboxRelay.stop();
clearInterval(graph.sagaSweeper);
await graph.sagaBroker.close();
```

(Add `outboxRelay`, `sagaSweeper`, `sagaBroker` to the `BuiltGraph` interface so `shutdown.ts` can read them.)

- [ ] **Step 5: Typecheck + full unit run + lint**

Run: `npx tsc --noEmit && npm run test:unit && npm run lint`
Expected: typecheck PASS; all unit suites PASS; biome + dependency-cruiser 0 violations.

- [ ] **Step 6: Commit**

```bash
git add src/composition/container.ts src/composition/shutdown.ts src/composition/broker-event-publisher.ts src/composition/saga-reply-consumer.ts src/modules/subscriptions/subscriptions.module.ts
git commit -m "feat(saga): wire orchestrator (relay, reply consumer, sweeper) into composition root"
```

---

## Task 12: Notification service composition wiring

**Files:**
- Modify: `src/services/notification/container.ts`
- Modify: `src/services/notification/main.ts` (if `start()`/`close()` need the new broker)

- [ ] **Step 1: Wire the saga broker into the notification graph**

In `container.ts`, add a `NotifSagaBroker` on its own connection and start it with the command handler. Extend `NotificationGraph`:

```ts
import { RabbitMqConnection } from '@/shared/messaging';
import { NotifSagaBroker } from './saga-broker';
import { buildSagaCommandHandler } from './saga-consumer';
// ...
export interface NotificationGraph {
  metrics: PrometheusMetricsCollector;
  consumer: RabbitMqConsumer;        // HW7 event consumer (release notifications)
  sagaBroker: NotifSagaBroker;       // saga command consumer
  start: () => Promise<void>;
  close: () => Promise<void>;
}
```

In `buildNotificationGraph`, after the existing consumer setup:

```ts
const sagaConnection = new RabbitMqConnection(
  config.rabbitmqUrl,
  logger.child({ component: 'saga-rabbitmq' }),
);
const sagaBroker = new NotifSagaBroker(sagaConnection, logger.child({ component: 'saga-broker' }));
const sagaHandler = buildSagaCommandHandler(service);

return {
  metrics,
  consumer,
  sagaBroker,
  start: async () => {
    await consumer.start(handler);
    await sagaBroker.start(sagaHandler);
  },
  close: async () => {
    await consumer.close();
    await sagaBroker.close();
  },
};
```

- [ ] **Step 2: Drop confirmation handling from the HW7 event consumer**

In `src/services/notification/consumer.ts`, the `SUBSCRIPTION_CREATED` branch is now dead (the monolith no longer publishes that event). Remove that branch so an unexpected `subscription.created` is rejected rather than silently emailing:

```ts
// consumer.ts — remove the SUBSCRIPTION_CREATED branch:
if (msg.routingKey === ROUTING_KEYS.RELEASE_DETECTED) {
  const p = msg.payload as NewReleaseDetectedMessage;
  for (const sub of p.subscribers) {
    await service.sendReleaseNotification(sub.email, sub.unsubscribeToken, p.repo, p.release);
  }
  return 'ack';
}
return 'reject';
```

Update `src/services/notification/__tests__/consumer.test.ts`: delete the "routes a subscription.created message" test; the unknown-key test already covers `reject`.

- [ ] **Step 3: Typecheck + tests + lint**

Run: `npx tsc --noEmit && npm run test:unit && npm run lint`
Expected: PASS; 0 lint violations.

- [ ] **Step 4: Commit**

```bash
git add src/services/notification/container.ts src/services/notification/main.ts src/services/notification/consumer.ts src/services/notification/__tests__/consumer.test.ts
git commit -m "feat(saga): notification service starts saga command consumer; drop event-based confirmation"
```

---

## Task 13: docker-compose env + ADR

**Files:**
- Modify: `docker-compose.yml` (env vars for both services)
- Create: `docs/adr/012-orchestrated-saga-outbox.md`

- [ ] **Step 1: Add env vars to docker-compose**

For the main service, add (alongside existing env):

```yaml
      OUTBOX_POLL_MS: "2000"
      OUTBOX_MAX_ATTEMPTS: "10"
      OUTBOX_BATCH_SIZE: "20"
      SAGA_TIMEOUT_MS: "60000"
      SAGA_SWEEP_MS: "30000"
```

Both services already have `RABBITMQ_URL` (HW7). No new infrastructure containers are needed — saga reuses the existing RabbitMQ.

- [ ] **Step 2: Write the ADR**

Create `docs/adr/012-orchestrated-saga-outbox.md` documenting: orchestration vs choreography (orchestrator in monolith), transactional outbox vs dual-write, polling relay vs CDC, hard-delete compensation, persisted saga state, timeout sweeper, at-least-once duplicate-email limitation. Follow the structure of `docs/adr/011-rabbitmq-message-broker.md`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml docs/adr/012-orchestrated-saga-outbox.md
git commit -m "docs(saga): add env config and ADR 012 (orchestrated saga + outbox)"
```

---

## Task 14: Final verification

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npm run test:unit && npm run lint && npm run build`
Expected: typecheck clean; all unit suites pass; biome + dependency-cruiser 0 violations; build succeeds.

- [ ] **Step 2: Boundary spot-check**

Confirm dependency-cruiser reports 0 violations specifically for:
- `src/shared/outbox/**` does not import `src/modules/**`.
- `src/services/notification/**` imports only `src/shared/**` (not `src/modules/**`).
- `src/modules/saga/**` does not import `src/composition/**` except `tokens.ts`.

Run: `npm run lint:boundaries`
Expected: 0 violations.

- [ ] **Step 3: Manual smoke (optional, requires running stack)**

With `docker compose up`: POST a subscription, confirm a confirmation email is produced by the mock email provider, and a `saga_instances` row reaches `COMPLETED`. Then point email provider to fail and confirm the subscription row is deleted and the saga reaches `COMPENSATED`.

- [ ] **Step 4: Final commit (if any cleanups)**

```bash
git add -A
git commit -m "chore(saga): final cleanups after full verification"
```

---

## Self-review notes

- **Spec coverage:** D1 orchestrator-in-monolith (Tasks 7,11); D2 explicit reply (Tasks 1,9); D3 persisted state (Tasks 2,6); D4 outbox single-tx (Tasks 3,8); D5 polling relay (Task 4); D6 hard-delete compensation (Tasks 7,11 closure); D7 confirmation-only-via-saga (Tasks 8,11,12); D8 separate exchanges (Tasks 1,5). Timeout sweeper (Tasks 7,11). Error matrix covered by ConfirmationSaga + relay tests (Tasks 4,7,9).
- **Boundary safety:** outbox is generic (no saga import); saga wire contract lives in `shared/messaging`; notification service imports only `shared`; compensation injected as a closure to avoid `saga -> subscriptions` import.
- **Type consistency:** `PrismaLike` defined once in `shared/outbox` and reused; `ConfirmationResultReply`/`SendConfirmationCommand` from `shared/messaging` used identically in monolith and notif; `start(input, tx)` signature consistent across saga, service, and tests.
