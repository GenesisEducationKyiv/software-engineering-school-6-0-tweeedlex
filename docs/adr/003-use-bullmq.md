# ADR 004: Use BullMQ for Job Queuing

**Status**: Accepted  
**Date**: 2026-04-10

## Context

Two background tasks need a reliable execution mechanism:

1. **Periodic release scanning** — runs every 5 minutes, must survive process restarts without duplicate runs.
2. **Email delivery** — must be retried on transient failures (Resend API timeouts, rate limits) without blocking the HTTP response path.

The service already depends on Redis (for GitHub API caching), so a Redis-based queue has zero extra infrastructure cost.

## Decision

Use **BullMQ v5** for both the notification queue and the scanner queue.

## Alternatives Considered

| Option | Reason rejected |
|--------|----------------|
| `node-cron` / `setInterval` | No persistence — restarts lose in-flight jobs and repeatable state. No retry. |
| `agenda` (MongoDB-backed) | Requires MongoDB; adds a third data store. |
| `pg-boss` (Postgres-backed) | Would work but adds Postgres table churn; BullMQ is simpler for this use case. |
| Raw Redis `ZADD`/`ZPOPMIN` | Requires reimplementing retries, delays, and visibility timeouts manually. |

## Rationale

- **Repeatable jobs**: BullMQ's `repeat: { every: N }` handles the scanner schedule natively, surviving restarts and deduplicating runs.
- **Retry with backoff**: Job-level `attempts` + `backoff: { type: 'exponential' }` covers transient email failures without custom logic.
- **Concurrency control**: Scanner worker is configured with `concurrency: 1` to prevent overlapping scans.
- **Redis already required**: No new infrastructure.

## Consequences

- BullMQ requires `ioredis` (not `node-redis`). The app uses two Redis clients: `node-redis` for cache operations (simpler API for GET/SET) and `ioredis` for BullMQ connections. This is the standard BullMQ pattern.
- The IORedis connection must set `maxRetriesPerRequest: null` and `enableReadyCheck: false` per BullMQ's requirements.
- Queue names are exported as constants (`NOTIFICATION_QUEUE`, `SCANNER_QUEUE`) to avoid string coupling between producers and workers.
