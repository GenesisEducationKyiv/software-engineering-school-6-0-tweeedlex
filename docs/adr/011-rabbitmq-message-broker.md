# ADR 011: RabbitMQ message broker between services

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
