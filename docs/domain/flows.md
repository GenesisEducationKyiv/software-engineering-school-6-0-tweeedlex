# Domain Flows

## Subscribe Flow

```
Client                     API                       GitHub API            DB              Email Queue
  │                         │                              │                │                   │
  │ POST /api/subscribe     │                              │                │                   │
  │ {email, repo}           │                              │                │                   │
  │────────────────────────►│                              │                │                   │
  │                         │ isValidRepoFormat(repo)?     │                │                   │
  │                         │──────────────────────────►(no)                │                   │
  │                         │◄── 400 Invalid format ───────│                │                   │
  │                         │                              │                │                   │
  │                         │ GET /repos/{owner}/{name}    │                │                   │
  │                         │─────────────────────────────►                 │                   │
  │                         │ 404? ◄───────────────────────                 │                   │
  │                         │◄── 404 Repo not found        │                │                   │
  │                         │                              │                │                   │
  │                         │ (cache hit skips API call)   │                │                   │
  │                         │                              │                │                   │
  │                         │ upsert Repo row              │                │                   │
  │                         │──────────────────────────────────────────────►│                   │
  │                         │                              │                │                   │
  │                         │ findByEmailAndRepo?          │                │                   │
  │                         │──────────────────────────────────────────────►│                   │
  │                         │ exists? ◄─────────────────────────────────────│                   │
  │                         │◄── 409 Already subscribed    │                │                   │
  │                         │                              │                │                   │
  │                         │ create Subscription          │                │                   │
  │                         │ (confirmToken, unsubToken)   │                │                   │
  │                         │──────────────────────────────────────────────►│                   │
  │                         │                              │                │                   │
  │                         │ enqueue confirmation job     │                │                   │
  │                         │──────────────────────────────────────────────────────────────────►│
  │                         │                              │                │                   │
  │◄── 200 OK               │                              │                │                   │
```

## Confirmation Flow

```
User (email client)        API                                              DB
  │                         │                                               │
  │ GET /api/confirm/:token │                                               │
  │────────────────────────►│                                               │
  │                         │ findByConfirmToken(token)                     │
  │                         │───────────────────────────────────────────────►
  │                         │ null? ◄────────────────────────────────────────
  │                         │◄── 404 Token not found                        │
  │                         │                                               │
  │                         │ UPDATE confirmed=true, confirmToken=null      │
  │                         │───────────────────────────────────────────────►
  │◄── 200 Confirmed        │                                               │
```

## Scanner Flow

```
Scheduler (BullMQ)         ScannerService             GitHub API           DB              NotificationQueue
  │                              │                         │                │                    │
  │ [every X min]                │                         │                │                    │
  │ trigger scan job             │                         │                │                    │
  │─────────────────────────────►│                         │                │                    │
  │                              │ findDistinctConfirmedRepos               │                    │
  │                              │──────────────────────────────────────────►                    │
  │                              │ [repo1, repo2, ...]  ◄────────────────── │                    │
  │                              │                         │                │                    │
  │                              │ for each repo:          │                │                    │
  │                              │ getLatestRelease()      │                │                    │
  │                              │────────────────────────►│                │                    │
  │                              │ {tag_name} ◄────────────│                │                    │
  │                              │                         │                │                    │
  │                              │ tag == last_seen_tag?   │                │                    │
  │                              │ → skip (no new release) │                │                    │
  │                              │                         │                │                    │
  │                              │ tag != last_seen_tag?   │                │                    │
  │                              │ updateRepoLastSeenTag   │                │                    │
  │                              │──────────────────────────────────────────►                    │
  │                              │ findAllConfirmedByRepoId│                │                    │
  │                              │──────────────────────────────────────────►                    │
  │                              │ [sub1, sub2, ...]  ◄──────────────────── │                    │
  │                              │ for each subscriber:    │                │                    │
  │                              │ enqueue release-notification job         │                    │
  │                              │─────────────────────────────────────────────────────────────► │
  │                              │                         │                │                    │
  │                              │ RateLimitError?         │                │                    │
  │                              │ → stop scan, log warning│                │                    │
```

## Unsubscribe Flow

```
User (email client)        API                                              DB
  │                         │                                               │
  │ GET /api/unsubscribe/   │                                               │
  │ :token                  │                                               │
  │────────────────────────►│                                               │
  │                         │ findByUnsubscribeToken(token)                 │
  │                         │───────────────────────────────────────────────►
  │                         │ null? ◄────────────────────────────────────────
  │                         │◄── 404 Token not found                        │
  │                         │                                               │
  │                         │ DELETE subscription                           │
  │                         │───────────────────────────────────────────────►
  │◄── 200 Unsubscribed     │                                               │
```

## Email Delivery Flow

```
NotificationQueue          NotificationWorker         Resend API
  │                              │                         │
  │ job: {type: 'confirmation'}  │                         │
  │ or {type: 'release-notification'}                      │
  │─────────────────────────────►│                         │
  │                              │ composeEmail(template)  │
  │                              │ sendEmail(to, subject, html)             
  │                              │────────────────────────►│
  │                              │ success ◄───────────────│
  │                              │                         │
  │                              │ failure?                │
  │                              │ retry (max 3, exponential backoff)
```
