# ADR 012 — Orchestrated Saga with Transactional Outbox

**Status:** Accepted  
**Date:** 2026-06-20

## Context

HW8 requires a distributed transaction spanning two microservices:
1. Monolith creates a subscription (PostgreSQL)
2. Notification service sends a confirmation email (SMTP)

Both must succeed or roll back atomically, even when RabbitMQ is temporarily unavailable.

## Decision

Use an **orchestrated saga** with the monolith as orchestrator and the notification service as participant, combined with a **transactional outbox** to eliminate the dual-write problem.

### Subscribe flow

1. `subscribe()` runs a single `prisma.$transaction`:
   - Creates `Subscription` row (status=UNCONFIRMED)
   - Creates `SagaInstance` row (status=STARTED)
   - Enqueues `OutboxMessage` row (exchange=saga.commands, routingKey=send-confirmation)
2. Outbox relay polls `OutboxMessage` table and publishes to RabbitMQ at-least-once.
3. Notification service consumes `saga.commands.confirmation` queue, sends email, publishes reply to `saga.replies.confirmation`.
4. Monolith's reply consumer calls `ConfirmationSaga.handleReply()`:
   - Success → `SagaInstance` status=COMPLETED
   - Failure → delete `Subscription`, status=COMPENSATED
5. Timeout sweeper compensates sagas stuck in STARTED longer than `SAGA_TIMEOUT_MS`.

## Consequences

**Good:**
- Atomic writes via single DB transaction (no dual-write)
- At-least-once delivery via outbox relay
- Clear failure modes: COMPLETED, COMPENSATED, or FAILED
- Bounded blast radius: only the subscription being subscribed is affected

**Bad:**
- Eventual consistency window: subscription exists briefly before email succeeds
- Extra tables: `SagaInstance`, `OutboxMessage`
- Timeout sweeper adds background complexity

## Alternatives Rejected

- **Choreography saga** (event-driven): harder to reason about, no central rollback logic
- **Two-phase commit (2PC)**: requires XA transactions, not supported by all drivers
- **Synchronous HTTP call**: tight coupling, no at-least-once guarantee, harder retry
