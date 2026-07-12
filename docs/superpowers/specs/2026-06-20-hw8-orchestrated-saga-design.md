# HW8 — Orchestrated Saga (Distributed Transaction Across Two Services)

- Status: design approved
- Date: 2026-06-20
- Branch (planned): `hw8-orchestrated-saga` (off `hw7-message-bus-message-broker`)
- Author: tweeedlex

## Goal

Implement a distributed transaction between two microservices using an
**orchestrated Saga**. The two participants:

1. **Monolith** (`github-subscriptions-service` main process) — the **orchestrator**.
2. **Notification service** (`src/services/notification`) — a **participant**.

The Saga covers the **subscribe flow**: creating a subscription row and
delivering its confirmation email must succeed together or roll back together.

## Why this flow

Today `SubscriptionService.subscribe()` performs a dual-write that is not atomic:

```text
repo.create(subscription)        // Postgres
events.publish(subscription.created)  // in-process bus -> BrokerEventPublisher -> RabbitMQ
```

If the process crashes between these two writes, the subscription exists but no
message is published, and there is no compensation. If the confirmation email
later fails inside the notification service, the subscription stays in the DB
with no email ever sent. There is no coordination and no rollback.

The Saga fixes both halves:

- **Transactional Outbox** removes the dual-write: subscription row, saga
  instance, and outbound command are written in a **single Postgres
  transaction**. A separate relay publishes the command afterward.
- **Orchestrated Saga** adds explicit coordination: the orchestrator waits for
  an explicit reply from the notification service and **compensates** (hard-deletes
  the subscription) when the email step fails.

## Scope decisions (approved)

| # | Decision |
|---|----------|
| D1 | **Orchestrator lives in the monolith.** Notification service is a dumb participant: it receives a command, sends the email, and replies. It holds no Saga state. |
| D2 | **Explicit reply message**, not RabbitMQ-ack-only. Notification service publishes `{sagaId, success, error?}` so the orchestrator gets the concrete outcome and can log the failure reason. |
| D3 | **Saga state persisted in Postgres** (`saga_instances`). In-memory would lose state on crash and degrade to plain request-reply. Persistence makes crash recovery and the timeout sweeper possible. |
| D4 | **Transactional Outbox** removes the subscribe dual-write. Subscription + saga instance + outbox row commit in one `prisma.$transaction`. |
| D5 | **Outbox relay = simple polling.** A poller reads `PENDING` rows on an interval, publishes, marks `SENT`. No Debezium/CDC. Reuses the existing BullMQ-style periodic pattern. |
| D6 | **Compensation = hard delete** of the subscription row. The rollback effect is visible and unambiguous; the user may re-subscribe afterward. |
| D7 | **Confirmation email now flows ONLY through the Saga.** `subscribe()` no longer publishes the `subscription.created` event. The HW7 event pipeline keeps handling **release notifications** only. This prevents double confirmation emails. |
| D8 | **New, separate RabbitMQ exchanges** (`saga.commands`, `saga.replies`). The HW7 `notifications` topic exchange is untouched. |

## Architecture

```text
MONOLITH (orchestrator)                       NOTIFICATION SERVICE (participant)
+------------------------------+
| SubscriptionService.subscribe|
|  +-- ONE Postgres tx -------+|
|  | INSERT subscription       ||
|  | INSERT saga_instance      ||  status=STARTED
|  | INSERT outbox_message     ||  status=PENDING
|  +---------------------------+|
+------------------------------+
        |
        v  OutboxRelay (poll every N ms)
   read outbox PENDING -> publish command -> mark SENT
        |
        v  exchange saga.commands (direct, durable)
        |   key saga.send-confirmation {sagaId, email, confirmToken, repo}
        |                                               |
        |                                               v
        |                            consume command -> sendConfirmationEmail
        |                                               |
        |                            publish reply <----+
        v  exchange saga.replies (direct, durable)
        |   key saga.confirmation-result {sagaId, success, error?}
        |
        v  SagaReplyConsumer (monolith)
   success -> saga_instance.status = COMPLETED
   failure -> COMPENSATE: DELETE subscription, status = COMPENSATED
```

A second monolith poller, the **timeout sweeper**, compensates sagas stuck in
`STARTED` longer than a timeout (covers a lost reply or a notification-service
crash before replying).

## Saga state machine

```text
[*] --> STARTED       (tx committed; waiting for reply)
STARTED --> COMPLETED (reply success:true)
STARTED --> COMPENSATED (reply success:false -> subscription deleted)
STARTED --> COMPENSATED (timeout sweeper -> subscription deleted)
COMPENSATED --> FAILED (compensation DELETE itself threw -> needs manual action)
```

The subscription stays `confirmed=false` throughout. The Saga guarantees "row
created AND confirmation email delivered", not user confirmation. The user still
clicks the email link to hit the existing `confirm()` endpoint.

## Data model

New Prisma models (new migration).

```prisma
model SagaInstance {
  id             String    @id @default(uuid())   // sagaId
  type           String                            // "confirmation"
  status         String                            // STARTED | COMPLETED | COMPENSATED | FAILED
  subscriptionId String    @map("subscription_id") // compensation target
  email          String
  repoSlug       String    @map("repo_slug")
  lastError      String?   @map("last_error")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  @@index([status])
  @@map("saga_instances")
}

model OutboxMessage {
  id          String    @id @default(uuid())
  sagaId      String    @map("saga_id")
  exchange    String                              // "saga.commands"
  routingKey  String    @map("routing_key")       // "saga.send-confirmation"
  payload     Json                                // {sagaId, email, confirmToken, repo}
  status      String    @default("PENDING")       // PENDING | SENT
  attempts    Int       @default(0)
  createdAt   DateTime  @default(now()) @map("created_at")
  sentAt      DateTime? @map("sent_at")

  @@index([status, createdAt])
  @@map("outbox_messages")
}
```

Notes:

- `outbox.status` is only `PENDING`/`SENT`. A failed publish leaves the row
  `PENDING` and bumps `attempts`; the relay retries on the next poll
  (at-least-once). After a configurable attempt cap the row stays `PENDING` and
  emits a metric/log for alerting — it is never silently dropped.
- `saga_instance.subscriptionId` is stored so compensation can `DELETE` without
  re-deriving it.

## Components

### Monolith — new files

```text
src/modules/saga/
  saga.contract.ts                 command/reply wire types, routing keys, exchange names, SAGA_SCHEMA_VERSION
  saga-orchestrator.interface.ts   ISagaOrchestrator
  confirmation-saga.ts             ConfirmationSaga: start(), handleReply(), compensate(), sweepTimeouts()
  saga.repository.interface.ts     ISagaRepository
  saga.repository.ts               Prisma: create (tx-aware), updateStatus, findById, findStaleStarted
  saga.module.ts                   DI registration (token + factory)
  index.ts                         barrel
  __tests__/confirmation-saga.test.ts

src/shared/outbox/
  outbox.repository.interface.ts   IOutboxRepository
  outbox.repository.ts             Prisma: enqueue (tx-aware), findPending, markSent, bumpAttempts
  outbox-relay.ts                  OutboxRelay: poll -> publish -> markSent
  index.ts
  __tests__/outbox-relay.test.ts

src/composition/
  saga-reply-consumer.ts           consumes saga.replies -> orchestrator.handleReply()
```

### Monolith — modified files

- `src/modules/subscriptions/subscription.service.ts` — `subscribe()` no longer
  publishes `subscription.created`. Instead it runs ONE `prisma.$transaction`
  that: creates the subscription row, creates the saga instance (STARTED), and
  enqueues the outbox command. Repository methods that participate gain a
  transactional-client parameter.
- `src/composition/container.ts` — register saga module, outbox relay, reply
  consumer; start the relay poller and the timeout sweeper.
- `src/composition/broker-event-publisher.ts` — remove `onSubscriptionCreated`
  (and its bus subscription). Keep `onNewReleaseDetected`.
- `prisma/schema.prisma` + new migration.

### Notification service — modified files

- `src/services/notification/consumer.ts` (or a new `saga-consumer.ts`) — handle
  the `saga.send-confirmation` command: call `sendConfirmationEmail`, then publish
  `saga.confirmation-result` on `saga.replies`. The HW7 event consumer stops
  handling `subscription.created` (it no longer arrives).
- `src/services/notification/container.ts` — wire the saga command consumer and a
  reply publisher.

### Transaction plumbing

`subscribe()`'s three writes must share one `prisma.$transaction(async (tx) => …)`.
The subscription repo `create`, the saga repo `create`, and the outbox repo
`enqueue` accept the Prisma transactional client. This is a small signature
refactor on those three methods.

## RabbitMQ topology (new, separate from HW7)

```text
exchange saga.commands (direct, durable)
  key saga.send-confirmation
  -> queue saga.commands.confirmation (durable, DLX -> saga.commands.dlx)
     retry path: dlx -> saga.commands.retry (message-TTL) -> back to saga.commands
     parking-lot after MAX attempts

exchange saga.replies (direct, durable)
  key saga.confirmation-result
  -> queue saga.replies.confirmation (durable)
```

Reuses the existing `assertTopology` DLX+TTL+parking-lot pattern in a separate
`saga/topology.ts`.

## Data flow

### Happy path

1. `subscribe()` -> one `$transaction`: INSERT subscription, INSERT
   saga_instance(STARTED), INSERT outbox(PENDING) -> commit.
2. OutboxRelay poll -> publish `saga.send-confirmation` -> markSent.
3. Notif consume command -> `sendConfirmationEmail` -> publish
   `saga.confirmation-result{success:true}`.
4. Reply consumer -> `saga_instance.status = COMPLETED`.

### Failure (email fails)

3'. Notif: `sendConfirmationEmail` throws -> publish reply `{success:false, error}`.
4'. Reply consumer -> compensate: `DELETE subscription`, `status = COMPENSATED`.

## Error handling matrix

| Failure point | Effect | Remediation |
|---|---|---|
| Crash after commit, before relay publish | outbox row stays PENDING | Relay picks it up next poll / on restart |
| Crash after publish, before markSent | duplicate publish | Notif is idempotent enough — duplicate email (accepted, as HW7) |
| RabbitMQ down during relay publish | publish throws | Row stays PENDING, retried next poll, `attempts` bumped |
| Notif email throws | reply success:false | Compensation deletes the subscription |
| Reply lost / notif crashes before replying | saga stuck STARTED | Timeout sweeper compensates after T |
| Compensation DELETE throws | status=FAILED | Log + metric, manual intervention |
| Duplicate reply (at-least-once) | — | Reply consumer checks status; ignores if already COMPLETED/COMPENSATED |

## Timeout sweeper

A second poller alongside the relay. Finds `saga_instance WHERE status=STARTED
AND createdAt < now - SAGA_TIMEOUT_MS` and compensates each. Without it, a saga
whose reply is lost hangs in STARTED forever. Same polling pattern as the relay.

## Idempotency

- **Reply consumer**: reads `saga_instance.status` before acting; a duplicate
  reply for an already-terminal saga is ignored.
- **Notification email**: at-least-once command delivery may send a duplicate
  confirmation email — accepted limitation, consistent with HW7.

## Configuration (new env)

| Var | Where | Meaning |
|---|---|---|
| `OUTBOX_POLL_MS` | main | Relay poll interval |
| `OUTBOX_MAX_ATTEMPTS` | main | Attempt cap before alert (row stays PENDING) |
| `SAGA_TIMEOUT_MS` | main | Stuck-STARTED threshold for the sweeper |
| `SAGA_SWEEP_MS` | main | Sweeper poll interval |

RabbitMQ URL is already configured in both services (HW7).

## Testing

- `confirmation-saga.test.ts` — start writes instance+outbox in one tx;
  handleReply success -> COMPLETED; handleReply fail -> compensate + DELETE +
  COMPENSATED; duplicate reply ignored; compensation throw -> FAILED;
  sweepTimeouts compensates stale STARTED, leaves fresh STARTED alone.
- `outbox-relay.test.ts` — PENDING -> publish -> markSent; publish throws ->
  stays PENDING + attempts bumped; empty outbox is a no-op.
- `saga-consumer.test.ts` (notif) — command -> email + reply success; email
  throws -> reply fail; unknown routing key -> reject.

## Out of scope

- No changes to the HW7 release-notification pipeline beyond removing the
  confirmation event from it.
- No CDC/Debezium.
- No saga across more than these two services.
- No retry of the email step from the orchestrator side (compensation, not retry,
  on email failure — the user re-subscribes).

## ADR follow-up

`docs/adr/012-orchestrated-saga-outbox.md` — record: orchestration vs
choreography choice, transactional outbox vs dual-write, hard-delete
compensation, persisted saga state, polling relay vs CDC.
