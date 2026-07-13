# Domain Glossary

## Core Terms

### Subscription
A relationship between an **email address** and a **repository**. A subscription can be in one of two states: **unconfirmed** (pending email verification) or **confirmed** (active). Only confirmed subscriptions receive release notifications and appear in `GET /api/subscriptions`.

### Repo
A GitHub repository identified by `owner/name` (e.g., `golang/go`). The system stores one `Repo` record per unique repository, shared across all subscriptions to that repository. The `Repo` record tracks `last_seen_tag`.

### Confirm Token
A one-time, URL-safe random token sent in the confirmation email. Clicking the confirmation link calls `GET /api/confirm/:token`, which marks the subscription as confirmed and nullifies the token (preventing reuse).

### Unsubscribe Token
A permanent, URL-safe random token embedded in every notification email. Clicking the unsubscribe link calls `GET /api/unsubscribe/:token`, which deletes the subscription. Unlike the confirm token, the unsubscribe token is never nullified.

### Last Seen Tag
The Git tag (`tag_name`) of the most recent GitHub release detected by the scanner for a given repository. Stored on the `Repo` record. When the scanner detects a new tag, it updates `last_seen_tag` and notifies all confirmed subscribers. A `null` value means no release has been detected yet.

### Release
A GitHub release associated with a Git tag. Fetched via `GET /repos/{owner}/{name}/releases/latest`. The scanner compares `tag_name` to `last_seen_tag` to determine if a notification is needed.

### Scanner
The background process that periodically checks all repos with confirmed subscriptions for new releases. Implemented as a BullMQ repeatable job running every 5 minutes.

### Notification
An email sent to a confirmed subscriber when a new release is detected. Includes the release name, tag, link to the release page, and an unsubscribe link.

### Confirmation Email
An email sent immediately after a subscription is created. Contains a confirmation link. The subscription remains unconfirmed (and inactive) until the link is clicked.

## Lifecycle

```
Subscribe → [unconfirmed] → Confirm → [confirmed] → Receives notifications
                                                    ↓
                                               Unsubscribe → [deleted]
```

## Constraints

- One email address may subscribe to many repositories, but only **once per repository** (duplicate → 409).
- A repository must exist on GitHub at subscription time (verified via GitHub API → 404 if missing).
- Repository format must be `owner/repo` — no slashes, dots, or other structures (→ 400 if invalid).
- Only confirmed subscriptions receive scanner notifications.
- The unsubscribe token persists even after the subscription is deleted (it simply has nothing to look up, returning 404).
