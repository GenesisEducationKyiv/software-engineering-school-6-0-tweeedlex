# HW7 — Message Bus & Message Broker

**Date:** 2026-06-19
**Branch target:** `hw7-message-broker` (off current `hw-6-monolith-microservices`)
**Status:** Approved design, ready for implementation plan

## Goal

Course HW7 requires:

1. Add a message broker.
2. Start publishing events or commands.
3. Create a notification service/module with a consumer of those events/commands.
4. Cover the consumer logic with tests.

The service is already split (HW6) into a **main service** and a **notification service**.
Today the cross-service hop is a **synchronous RPC** (HTTP or gRPC). HW7 replaces that hop
with an asynchronous **RabbitMQ** broker so the services are decoupled.

## Current State

```
[main]  scanner / subscriptions
          -> InProcessEventBus            (in-process pub/sub)
          -> NotificationHandlers
          -> INotificationClient          (HTTP or gRPC RPC)  --network-->
[notif] ingress (HTTP/gRPC)
          -> BullMQ producer -> BullMQ worker
          -> NotificationService -> email
```

- `IEventBus` (`src/shared/events/`) is **in-process only**: `publish()` runs all handlers
  synchronously and aggregates their failures into an `AggregateError`.
- The inter-service hop is the synchronous `INotificationClient` RPC call.
- The notification service uses its **own** BullMQ queue (Redis) for email retry/backoff.
- The main service also uses BullMQ for the **scanner** (`SCANNER_QUEUE`) — unrelated, untouched.

## Target State

```
[main]  scanner / subscriptions
          -> InProcessEventBus            (UNCHANGED, in-process)
          -> BrokerEventPublisher         (subscribes to the in-process bus)
          -> RabbitMQ topic exchange      --broker-->
[notif] RabbitMQ consumer
          -> NotificationService -> email
          ok   -> ack
          fail -> nack -> DLX -> retry queue (TTL) -> back to exchange
          >N   -> parking-lot DLQ
```

The synchronous RPC hop is removed. The main service no longer waits on the notification
service; it publishes a durable message and returns.

## Key Decisions

### D1 — Do NOT bend `IEventBus` into the broker

`IEventBus` stays as-is: in-process synchronous fan-out within a single process. The broker
gets a **separate** abstraction (`IMessagePublisher` / `IMessageConsumer`).

**Why:** `IEventBus.publish()` synchronously awaits every handler and re-throws their errors
as an `AggregateError`. A network broker is fire-and-forget — it cannot return remote
handler errors. Forcing one interface to mean both "local sync fan-out" and "network async
delivery" leaks. Two abstractions keep the boundaries honest. The in-process bus still has a
job: local fan-out inside the main process (e.g. metrics, future local subscribers).

### D2 — The RPC hop is removed, not kept alongside

Once the notification service consumes from the broker, the main service no longer calls it
over RPC. The HTTP/gRPC ingress is **not** the main path anymore. We keep only a minimal
HTTP `/healthz` (liveness/readiness for Docker). The HTTP/gRPC notification ingress and the
`src/modules/notifications/` RPC clients in the main service are removed.

### D3 — Remove BullMQ from the notification service

RabbitMQ + a dead-letter retry path covers both inter-service transport **and** email
retry/backoff. The notification service's BullMQ usage is self-contained and removed:

- Removed: `BullMQConnection` / `BullMQProducer` / `BullMQWorkerFactory` wiring in
  `services/notification/container.ts`, `internal/notification.worker.ts`,
  `internal/notification.queue.ts`, `ingress.service.ts`.
- Kept: `NotificationService.sendConfirmationEmail` / `sendReleaseNotification` (the real
  work) — these become the consumer's handler target.
- The notification service no longer depends on Redis.
- The main service's **scanner** BullMQ is untouched.

### D4 — Events, not commands

`subscription.created` and `scanner.new-release-detected` are past-tense facts. The
notification service decides on its own to react by sending email. That is the event
semantic (not a command telling it what to do), and it matches the existing `DomainEvent`
types. **Trade-off:** delivery is at-least-once, so a retried message can send a duplicate
email. Acceptable for this project; noted as a known limitation (see Error Handling).

## Components

### New shared abstraction — `src/shared/messaging/`

| File | Responsibility |
| ---- | -------------- |
| `message-broker.interface.ts` | `IMessagePublisher` (`publish(routingKey, message)`), `IMessageConsumer` (`consume(queue, handler)`), `BrokerMessage`, `MessageHandler` returning `'ack' \| 'retry' \| 'reject'`. |
| `messaging.contract.ts` | Versioned wire messages (`SubscriptionCreatedMessage`, `NewReleaseDetectedMessage`) + routing-key constants. Separate from in-process `DomainEvent` because the wire contract must stay stable across deploys. |
| `rabbitmq/topology.ts` | Single source of truth for exchange / queue / DLX names and assert logic. |
| `rabbitmq/rabbitmq-connection.ts` | `amqplib` connection + channel wrapper; reconnect with backoff; graceful close. |
| `rabbitmq/rabbitmq-publisher.ts` | Publish to the topic exchange; `persistent: true`; confirm channel. |
| `rabbitmq/rabbitmq-consumer.ts` | Assert topology, set prefetch, `consume`, map handler result to ack/nack, drive the retry / parking-lot logic. |

### RabbitMQ topology

```
exchange: notifications              (topic, durable)
  routing keys:
    subscription.created
    release.detected

queue: notifications.email           (durable; DLX -> notifications.dlx)
  bindings: subscription.created, release.detected

retry path (DLX + message TTL):
  exchange: notifications.dlx         (direct, durable)
  queue:    notifications.retry       (durable; message-TTL = RETRY_DELAY_MS;
                                       dead-letters back to the notifications exchange)
  queue:    notifications.parking-lot (durable; terminal failures after MAX_ATTEMPTS)
```

Attempt count is read from the `x-death` header. Consumer policy: `attempts < MAX_ATTEMPTS`
=> reject to the retry queue; `attempts >= MAX_ATTEMPTS` => publish to parking-lot, then ack
the original so it leaves the main queue.

### Main service changes

- `composition/container.ts`: remove resolving `NOTIFICATION_CLIENT`, building
  `NotificationHandlers`, and `registerNotificationHandlers`.
- Add `BrokerEventPublisher`: subscribes to the in-process bus for `SUBSCRIPTION_CREATED`
  and `NEW_RELEASE_DETECTED`, maps `DomainEvent -> wire message`, publishes to RabbitMQ.
- Remove `src/modules/notifications/` (HTTP + gRPC clients, handlers).
- Add the RabbitMQ connection to `createInfraInstances` (infra module).

### Notification service changes

- `container.ts`: drop BullMQ; add RabbitMQ connection + consumer wired to
  `NotificationService`.
- New `consumer.ts`: map a wire message to `service.sendConfirmationEmail` /
  `sendReleaseNotification`.
- Remove `internal/notification.worker.ts`, `internal/notification.queue.ts`
  (the `NotificationJob` shape moves into the messaging contract), `ingress.service.ts`.
- `main.ts`: boot the consumer instead of the BullMQ worker; shutdown closes RabbitMQ.

### Infra / ops

- `docker-compose`: add a `rabbitmq:3-management` service (AMQP 5672, UI 15672) with a
  healthcheck; main and notif depend on it healthy.
- Env: `RABBITMQ_URL` for both services; `RETRY_DELAY_MS`, `MAX_ATTEMPTS` for the consumer.
- Remove the notification service's `REDIS_URL` dependency.

## Error Handling

| Failure | Behavior |
| ------- | -------- |
| Publish fails (main, broker down) | Confirm channel reports failure -> log + throw so the originating action (subscribe / scan) fails loudly. No silent drop. |
| Handler throws (notif, e.g. email provider 5xx) | `'retry'` -> nack to DLX -> retry queue (TTL delay) -> redelivered. |
| Unparseable / invalid payload (poison message) | `'reject'` -> straight to parking-lot, **no requeue**, so it cannot loop forever. |
| Attempts exceed `MAX_ATTEMPTS` | Move to parking-lot DLQ for manual inspection; ack original. |
| Connection loss | `rabbitmq-connection` reconnects with backoff; consumer re-asserts topology and resumes. |
| Duplicate delivery (at-least-once) | Possible duplicate email. Known limitation for HW; future fix = idempotency key + dedupe store. |

## Testing

Consumer logic coverage is the graded requirement.

**Unit (mock channel / `amqplib`):**

- `rabbitmq-consumer.test.ts`
  - success -> ack
  - handler returns retry -> nack/reject routed to retry queue
  - attempts >= MAX -> routed to parking-lot, original acked
  - invalid payload -> reject without requeue
  - each routing key parsed to the right message type
- `consumer.test.ts` (notif)
  - `SubscriptionCreatedMessage` -> `service.sendConfirmationEmail` with mapped args
  - `NewReleaseDetectedMessage` -> `service.sendReleaseNotification` per subscriber
  - service throws -> handler returns retry
- `broker-event-publisher.test.ts` (main)
  - `SubscriptionCreatedEvent` -> publish with routing key `subscription.created` and mapped payload
  - `NewReleaseDetectedEvent` -> routing key `release.detected`
  - publish failure propagates

**Integration (optional, dockerized real RabbitMQ):**

- publish from main -> consume in notif -> mock email provider called
- forced handler failure -> message lands in retry queue, then parking-lot after MAX

## Out of Scope (YAGNI)

- Idempotent delivery / dedupe store.
- Multiple consumer instances / competing-consumer scaling.
- Schema registry for messages (a versioned TS contract is enough here).
- Replacing the scanner's BullMQ with RabbitMQ.
- Saga / outbox pattern for transactional publish.

## ADR Follow-up

Add an ADR under `docs/adr/` recording: choice of RabbitMQ over Redis Streams / Kafka, the
DLX+TTL retry strategy, and removal of BullMQ from the notification service.
