# ADR 009: Extract Notification into a Separate Service

**Status**: Accepted
**Date**: 2026-06-11

## Context

HW6 required splitting one module into a separate service exposing both HTTP and gRPC APIs. Notification was the cleanest extraction candidate: it was already fully decoupled from the rest of the monolith behind domain events, had no shared database tables, and its only job was to accept a send-email request and deliver it reliably.

## Decision

Extract notification into a **separate process within the same repository** (`src/services/notification/`). It gets its own `Dockerfile.notification`, its own compose service, and its own Redis instance (for BullMQ).

The service exposes two ingress paths:
- **HTTP** (Fastify): `POST /notifications/send`
- **gRPC** (`@grpc/grpc-js`): `NotificationService.SendNotification`

The active transport is selected by the `NOTIFICATION_TRANSPORT` environment variable (`http` | `grpc`). The monolith calls the notification service through an `INotificationClient` interface; the concrete implementation is swapped at startup.

Internally the notification service preserves the prior queue-based delivery semantics: the ingress validates the request, enqueues a BullMQ job, and returns 202. A separate worker processes the queue and calls Resend with exponential-backoff retries. This preserves at-least-once delivery and keeps the API latency independent of Resend's response time.

## Alternatives Considered

| Option | Reason rejected |
|--------|----------------|
| Separate repository / npm package | Duplicates tooling, requires publishing shared proto/types, adds significant overhead for a course project. |
| In-process module with a network API shim | Not a real process boundary — the separation is cosmetic and doesn't test actual service-to-service communication. |
| Synchronous send without an internal queue | Loses retry semantics; benchmark latency would be dominated by Resend API round-trip time rather than the ingress. |

## Rationale

Keeping both services in one repository preserves a single git history and shared TypeScript types without a publish step. The event-driven seam that already existed made the coupling easy to sever — the monolith went from firing an in-process event to calling a network client, with the rest of its logic unchanged. The internal queue inside the notification service preserves the delivery guarantees that existed before extraction.

## Consequences

- The monolith no longer runs a notification BullMQ worker or producer; those were removed from `BuiltGraph`.
- A separate config loader was required: `src/config/notification-env.ts` (`loadNotificationConfig`). The shared `src/config/env.ts` eagerly calls `requireEnv('DATABASE_URL')` at import time; importing it inside the notification service (which has no database) would crash the process at boot. The notification service loads only the env vars it needs.
- Integration and e2e tests were verified end-to-end with the notification service running as an independent process.
- Proto definitions live in `src/services/notification/proto/`; both the server and the monolith-side client import them directly (no generated stubs committed).
