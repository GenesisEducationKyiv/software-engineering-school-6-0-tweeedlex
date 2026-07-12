# Modular / Microservices Refactor — Design

Date: 2026-06-11
Branch: `hw-6-monolith-microservices`
Status: Approved (brainstorming complete)

## Goal

Refactor the GitHub release notification service toward stronger module boundaries and a
microservice split, satisfying the HW6 assignment:

1. Define and document clear boundaries between modules/services.
2. Give every module/service a public API; route all inter-module communication through it.
3. Extract one service and expose it over **both HTTP and gRPC**; benchmark the two transports
   on key operations and write up conclusions.

## Decisions (locked during brainstorming)

| Topic | Decision |
| ----- | -------- |
| Service shape | Notification service = separate **process**, same repo (own entrypoint + Dockerfile + compose service). |
| Comm pattern | Sync API **replaces** the cross-process queue on the call path. Monolith calls notif service over HTTP/gRPC. |
| Retry model | Notif service keeps an **internal BullMQ + Redis** queue. API = thin ingress: validate → enqueue → `202`. Worker drains + retries + sends. |
| Boundary tool | **dependency-cruiser** replaces custom `scripts/check-module-boundaries.ts`. |
| Public API mechanism | Replace manual `build-graph.ts` wiring + `index.ts` barrels with a **tsyringe DI container**. Each module's public API = exported **DI token + interface + `registerXModule`**; concrete classes stay internal. |
| Benchmark | Light one-shot Node harness: `autocannon` (HTTP) + hand-rolled `@grpc/grpc-js` loop (gRPC). Same workloads, mock email. Dumps JSON; results drive a written MD comparison. |
| Benchmark scope | Both ops: `sendConfirmation` (small payload) + `sendReleaseNotification` (larger payload). Mock email provider during benchmark. |

## Current state (baseline)

- Modular monolith, one process. Modules: `github`, `subscriptions`, `scanner`, `notifications`,
  `grpc`, `auth`, `metrics`. Shared: `errors/events/logger/metrics/queue/utils`. Infra: `db/redis`.
- Manual constructor DI in `src/composition/build-graph.ts`; cross-module imports go through
  `index.ts` barrels; enforced by `scripts/check-module-boundaries.ts` (barrel-only rule,
  composition root exempt).
- Notification handoff today: `SubscriptionService` / `ScannerService` publish domain events on an
  in-process event bus → `NotificationHandlers` enqueue BullMQ jobs → `buildNotificationWorker`
  drains → `NotificationService` sends email (Resend or mock).
- Existing gRPC: `proto/subscription.proto`, `grpc.server.ts` (subscription ops), AppError→gRPC
  status mapping, `x-api-key` via metadata. Reusable patterns for the new service.

## Architecture after refactor

```
┌─────────────── monolith process ───────────────┐      ┌──── notification process ────┐
│ subscriptions / scanner / github / grpc / ...   │      │  HTTP API (Fastify) ─┐        │
│ event bus → NotificationHandlers                │ ───▶ │  gRPC API ───────────┼─▶ queue│
│   → NotificationClient (HTTP | gRPC)            │      │  (validate→enqueue→202)       │
└─────────────────────────────────────────────────┘      │  BullMQ worker → email provider│
                                                          └────── Redis (own) ───────────┘
```

## Workstream A — tsyringe DI + public module APIs

Deps: `tsyringe`, `reflect-metadata`. tsconfig: `experimentalDecorators`,
`emitDecoratorMetadata`, `useDefineForClassFields: false`. `import 'reflect-metadata'` at top of
every entrypoint.

Per-module public surface lives in `modules/<m>/<m>.module.ts` (replaces the barrel role):

```ts
// modules/github/github.module.ts  — the public API
export const GITHUB_SERVICE = Symbol('GitHubService') as InjectionToken<IGitHubService>;
export interface IGitHubService {
  verifyRepo(owner: string, name: string): Promise<GitHubRepo>;
  getLatestRelease(owner: string, name: string, bypassCache?: boolean): Promise<GitHubRelease | null>;
}
export type { GitHubRepo, GitHubRelease } from './github.types';
export function registerGithubModule(c: DependencyContainer): void {
  c.register(GITHUB_CLIENT,  { useClass: GitHubClient });
  c.register(GITHUB_CACHE,   { useClass: GitHubCache });
  c.register(GITHUB_SERVICE, { useClass: GitHubService });
}
```

- Concrete classes become `@injectable()` and `@inject(TOKEN)` their dependencies.
- Consumers inject the **token typed as the interface** — never import the concrete class. That is
  the enforced public-API contract.
- Non-class deps (config, child loggers, baseUrl) get tokens: `CONFIG`, `ROOT_LOGGER`, factory
  tokens for child loggers.
- `build-graph.ts` → `composition/container.ts`:

```ts
export function buildContainer(config: Config, logger: ILogger): DependencyContainer {
  const c = container.createChildContainer();
  c.registerInstance(CONFIG, config);
  c.registerInstance(ROOT_LOGGER, logger);
  registerInfraModule(c);            // prisma, redis, bullmq, metrics, eventBus
  registerGithubModule(c);
  registerSubscriptionsModule(c);
  registerScannerModule(c);
  registerNotificationClientModule(c); // monolith-side HTTP|gRPC client
  return c;
}
```

`main.ts` resolves root tokens (`SUBSCRIPTION_SERVICE`, `SCANNER_SERVICE`, workers, scheduler),
starts HTTP + gRPC, registers shutdown (resolve disposables, close in order).

Modules getting token+interface: `github`, `subscriptions`, `scanner`, `notification-client`
(monolith side), plus infra tokens for shared mechanisms. Leaf modules (`auth` plugin,
`metrics` route) get a `register*` fn for consistency; may expose a class token directly when no
cross-module consumer needs an interface.

## Workstream B — dependency-cruiser boundaries

Deps: `dependency-cruiser` (dev). Graph rendering: prefer graphviz `dot`; fallback emit `.dot` +
mermaid in the doc (no binary needed).

Scripts:
- `lint:boundaries` → `depcruise src --config .dependency-cruiser.cjs`
- `boundaries:graph` → `depcruise src --include-only "^src" --output-type dot > docs/architecture/deps.dot`
- `lint` = `biome check .` + `lint:boundaries`.
- Delete `scripts/check-module-boundaries.ts`.

Rules in `.dependency-cruiser.cjs`:

1. **no-cross-module-deep-import** (error): file in `modules/A/**` may import `modules/B` only via
   `modules/B/*.module.ts`. (`from: modules/([^/]+)`, `to: modules/(?!\1)[^/]+/(?!.*\.module\.ts$)`.)
2. **composition/services exempt**: rule 1's `from` scoped to `modules`, so `composition/**` and
   `services/*/main.ts` may wire freely.
3. **no-orphans** (warn): dead files.
4. **no-circular** (error): dependency cycles.
5. **modules-dont-import-composition** (error): `modules/**` may not import `composition/**` / `services/**`.
6. **shared-is-leaf** (error): `shared/**` may not import `modules/**`.

Doc: `docs/architecture/module-boundaries.md` — module table + public surface + rules + embedded
dependency graph. Satisfies assignment ask #1.

## Workstream C — Notification service extraction

Layout:

```
src/services/notification/
  main.ts                  # reflect-metadata, container, start HTTP+gRPC + worker, shutdown
  container.ts             # tsyringe wiring for this process
  http/server.ts           # Fastify: POST /notifications/confirmation, /notifications/release
  http/schema.ts           # request JSON schemas
  grpc/notification.server.ts  # gRPC impl
  ingress.service.ts       # validate → enqueue → ack; called by BOTH transports
proto/notification.proto   # new proto
```

Reused as-is (moved, not rewritten): `notification.service.ts`, `email.provider.ts`,
`resend.provider.ts`, `mock-email.provider.ts`, `notification.worker.ts`, `notification.queue.ts`
(job types), `templates/`.

New proto:

```proto
service NotificationService {
  rpc SendConfirmation (ConfirmationRequest) returns (AckResponse);
  rpc SendReleaseNotification (ReleaseRequest) returns (AckResponse);
}
message ConfirmationRequest { string email = 1; string confirm_token = 2; string repo = 3; }
message Release { string tag_name = 1; string name = 2; string html_url = 3; string published_at = 4; }
message ReleaseRequest { string email = 1; string unsubscribe_token = 2; string repo = 3; Release release = 4; }
message AckResponse { string status = 1; string job_id = 2; }
```

HTTP mirror: `POST /notifications/confirmation` `{email,confirmToken,repo}`,
`POST /notifications/release` `{email,unsubscribeToken,repo,release}` → `202 {status,jobId}`.

`ingress.service.ts` — single code path both transports call:
- `enqueueConfirmation(p)` → `producer.enqueue('send-confirmation', {...}, {attempts:3, backoff:{type:'exponential',delay:2000}})` → jobId
- `enqueueRelease(p)` → `producer.enqueue('send-release-notification', {...}, {attempts:3, backoff})` → jobId

Auth: same `x-api-key` (HTTP header / gRPC metadata), reusing the existing grpc.server pattern.

Monolith side — `NotificationClient`:

```ts
export interface INotificationClient {
  sendConfirmation(email: string, confirmToken: string, repo: string): Promise<void>;
  sendReleaseNotification(email: string, unsubscribeToken: string, repo: string, release: ReleaseEventPayload): Promise<void>;
}
```

Two impls: `HttpNotificationClient`, `GrpcNotificationClient`, selected by env
`NOTIFICATION_TRANSPORT=http|grpc`. `NotificationHandlers` now call the client instead of a local
producer; event-bus wiring unchanged (only the handler body swaps queue → client).

Config additions: `NOTIFICATION_HTTP_URL`, `NOTIFICATION_GRPC_ADDR`, `NOTIFICATION_TRANSPORT`, and
notif process own `PORT` / `GRPC_PORT` / `REDIS_URL`.

docker-compose: add `notification` service (own container, own Redis), monolith `depends_on` it.

Shutdown: notif process closes HTTP, gRPC, worker, producer, BullMQ, Redis. Monolith closes
notification client connections.

## Workstream D — Benchmark + comparison doc

`scripts/bench/run.ts`, command `npm run bench`. ~100 lines, one config object.

- Preconditions: notif service running, `EMAIL_PROVIDER=mock` (compose profile `bench`).
- HTTP: `autocannon` programmatic API. gRPC: hand-rolled loop over `@grpc/grpc-js` (no new dep),
  same iteration count + concurrency as HTTP → apples-to-apples.
- Workloads: 2 ops × 2 transports = 4 runs. Confirmation (small) + release (larger payload).
- Metrics per run: req/sec, latency p50/p90/p99/max, total bytes sent, avg payload size, errors.
- Output: `bench/results/<timestamp>.json` + `bench/results/latest.json`. Measures **ingress
  (accept → 202)** — the transport comparison; worker send is async and out of the measured path.
- Then read `latest.json` → write `docs/architecture/http-vs-grpc.md`: table + analysis +
  conclusions (assignment ask #3).

## Testing

- Moved notif internals keep their existing unit tests.
- New: `ingress.service` unit test (validate → enqueue); `NotificationClient` HTTP + gRPC tests
  against a mock server; contract test that HTTP and gRPC produce identical jobs.
- DI smoke test: `buildContainer` resolves all root tokens without throwing.
- dependency-cruiser runs in CI via `lint`.
- Existing integration/e2e: monolith integration/unit tests stub `NotificationClient`; e2e uses the
  real notif service via test compose.

## Migration order (phases)

1. tsyringe + reflect-metadata; convert classes to `@injectable`; build `*.module.ts` + container;
   behavior identical (still one process). Tests green.
2. Swap `check-module-boundaries` → dependency-cruiser; add rules + graph + doc. Clean run.
3. Extract notification to `services/notification`: move files, add proto, HTTP + gRPC servers,
   ingress. Notif runs standalone.
4. Monolith `NotificationClient` (HTTP + gRPC); rewire handlers; compose wiring; config.
5. Benchmark harness; run; write comparison doc.
6. Docs: boundaries doc; ADRs.

Each phase independently testable and commitable.

## ADRs to add

- `007-di-container-tsyringe`
- `008-dependency-cruiser-boundaries`
- `009-notification-service-extraction`
- `010-http-vs-grpc-comparison`

## Out of scope (YAGNI)

- Extracting any module other than notification.
- Separate repo / npm workspace for the notif service.
- Service mesh, message broker beyond existing BullMQ/Redis.
- Auth changes beyond reusing `x-api-key`.
