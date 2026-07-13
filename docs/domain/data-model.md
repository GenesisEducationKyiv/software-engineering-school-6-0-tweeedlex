# Data Model

## Entity Relationship

```
┌──────────────────────────────┐         ┌─────────────────────────────────────────┐
│             Repo             │         │              Subscription               │
├──────────────────────────────┤         ├─────────────────────────────────────────┤
│ id            UUID (PK)      │◄────────│ id               UUID (PK)              │
│ owner         VARCHAR        │  1:N    │ email            VARCHAR                │
│ name          VARCHAR        │         │ repo_id          UUID (FK → repos.id)   │
│ last_seen_tag VARCHAR?       │         │ confirmed        BOOLEAN (default false) │
│ created_at    TIMESTAMP      │         │ confirm_token    VARCHAR? (UNIQUE)       │
│ updated_at    TIMESTAMP      │         │ unsubscribe_token VARCHAR (UNIQUE)      │
└──────────────────────────────┘         │ created_at       TIMESTAMP              │
                                         │ updated_at       TIMESTAMP              │
                                         └─────────────────────────────────────────┘
```

## Constraints

| Table | Constraint | Purpose |
|-------|-----------|---------|
| `repos` | `UNIQUE(owner, name)` | One row per GitHub repo |
| `subscriptions` | `UNIQUE(email, repo_id)` | One subscription per email+repo |
| `subscriptions` | `UNIQUE(confirm_token)` | Token lookup uniqueness |
| `subscriptions` | `UNIQUE(unsubscribe_token)` | Token lookup uniqueness |
| `subscriptions` | `INDEX(email)` | Fast lookup by email for `GET /subscriptions` |

## State Transitions for Subscription

```
CREATE:
  confirmed = false
  confirm_token = <random 43-char token>
  unsubscribe_token = <random 43-char token>

AFTER CONFIRM:
  confirmed = true
  confirm_token = NULL  ← one-time use, prevents replay

AFTER UNSUBSCRIBE:
  row deleted
```

## Token Properties

- Generated via `crypto.randomBytes(32).toString('base64url')`
- 43 characters, URL-safe (no `+`, `/`, `=`)
- Stored as plain text (not sensitive credentials — purpose is routing, not authentication)
- `confirm_token`: nullable, set to `NULL` after use
- `unsubscribe_token`: non-nullable, permanent for the subscription lifetime
