# ADR 003: Store `last_seen_tag` on the Repo Table, Not Per Subscription

**Status**: Accepted  
**Date**: 2026-04-10

## Context

The swagger contract returns `last_seen_tag` as a field on each `Subscription` object in `GET /api/subscriptions`. Naively, this suggests storing `last_seen_tag` on the subscription row. However, `last_seen_tag` represents the most recently observed release of a repository — a property of the repository itself, not the subscriber relationship.

Consider: 100 users subscribe to `golang/go`. When release `v1.22.0` is published, should the system update 100 rows? Or 1?

## Decision

Store `last_seen_tag` on the `Repo` table as a single source of truth. Join the repo row into the subscription response DTO in `GET /api/subscriptions`.

```
Repo { id, owner, name, last_seen_tag }  ← updated once per scan
Subscription { id, email, repo_id, ... } ← many per repo
```

The response mapper in `SubscriptionRepository.findAllByEmail()` constructs `{ email, repo, confirmed, last_seen_tag }` from the join, satisfying the swagger contract.

## Alternatives Considered

**Store `last_seen_tag` on each Subscription row**  
- Scanner must update N rows (one per subscriber) when a release is found.
- Risk of partial updates: some subscribers see the new tag, others don't, if the scan is interrupted.
- Wastes write capacity proportional to subscriber count.

## Rationale

- **Single write per release**: The scanner updates one `Repo` row when a new release is detected, then reads all subscribers from that repo. Atomic from the scanner's perspective.
- **No drift**: All subscribers see the same `last_seen_tag` value; it cannot fall out of sync between rows.
- **Correct data model**: `last_seen_tag` is a fact about the repo, not the subscriber. Placing it on `Subscription` would be a denormalization that buys nothing here.

## Consequences

- `GET /api/subscriptions` performs a JOIN (`include: { repo: true }` in Prisma), which is a single SQL query — no N+1.
- The swagger contract is satisfied: `last_seen_tag` appears on each subscription response object.
- A user who subscribes before any release is published will see `last_seen_tag: null` until the first scan detects a release.
