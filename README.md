# GitHub Release Notification API

An API service that allows users to subscribe to email notifications about new releases of a chosen GitHub repository.

**Live**: https://github-subscriptions.tweeedlex.xyz  
**Swagger UI**: https://github-subscriptions.tweeedlex.xyz/docs

## Implemented Requirements

### Core

- **REST API** — all 4 required endpoints implemented and matching the Swagger contract (`POST /api/subscribe`, `GET /api/confirm/:token`, `GET /api/unsubscribe/:token`, `GET /api/subscriptions`)
- **Double opt-in** — subscription is created unconfirmed; a confirmation email is sent via [Resend](https://resend.com); only confirmed subscriptions receive notifications
- **Release scanner** — BullMQ repeatable job runs every `SCAN_INTERVAL_MS` (default 5 min), fetches latest release for each confirmed repo via GitHub API, and sends notification emails when `tag_name` changes
- **`last_seen_tag`** — stored per repo (not per subscription) to avoid redundant checks; updated on each detected release
- **GitHub repo validation** — on subscribe, the repo is verified via `GET /repos/:owner/:name`; returns 404 if not found, 400 if format is invalid; accepts both `owner/repo` and full GitHub URLs
- **Rate limit handling** — `X-RateLimit-Remaining` is checked after every GitHub API call; if remaining < 5, a `RateLimitError` is thrown; the scanner stops gracefully and resumes on the next interval; `429` responses from GitHub are also handled
- **Database migrations on startup** — `prisma migrate deploy` runs automatically before the server starts, both locally and in Docker
- **Modular Monolith** — single service split by feature (github, subscriptions, scanner, notifications) with a shared infrastructure layer (db, redis, queue)

### Architecture

The system is a **modular monolith plus two extracted microservices**:

- **Monolith** — feature modules (`subscriptions`, `scanner`) over a shared infrastructure layer (`db`, `redis`, `queue`, `events`, `metrics`, `logger`).
- **GitHub service** — extracted into its own process (`src/services/github/`, `Dockerfile.github`), reachable over **both HTTP and gRPC**. Owns the GitHub API client and Redis cache. The monolith calls it via `GITHUB_TRANSPORT=http|grpc` (default: `grpc`). Ports: `:3200` (HTTP), `:50062` (gRPC).
- **Notification service** — extracted into its own process (`src/services/notification/`, `Dockerfile.notification`), reachable over **both HTTP and gRPC**. The monolith calls it via an `INotificationClient`, switchable with `NOTIFICATION_TRANSPORT=http|grpc`.

**Dependency injection (tsyringe).** Each module exposes a public API of `{ DI token + interface + registerXModule(container) }`; concrete classes are internal. The composition root (`src/composition/container.ts`) wires the graph by resolving tokens — there is no hand-written `build-graph`. See [ADR 007](docs/adr/007-di-container-tsyringe.md).

**Enforced module boundaries (dependency-cruiser).** Cross-module imports may only go through a module's public API; `npm run lint` fails on violations, cycles, and stray composition imports. See [docs/architecture/module-boundaries.md](docs/architecture/module-boundaries.md) and [ADR 008](docs/adr/008-dependency-cruiser-boundaries.md).

**Why notification was the service to extract, and how the monolith talks to it:** [ADR 009](docs/adr/009-notification-service-extraction.md). **HTTP vs gRPC benchmark + the choice:** [docs/architecture/http-vs-grpc.md](docs/architecture/http-vs-grpc.md) and [ADR 010](docs/adr/010-http-vs-grpc-comparison.md).

**GitHub service extraction and gRPC/buf:** [ADR 011](docs/adr/011-github-service-grpc-buf.md). Uses `buf` (v2, STANDARD lint) for proto governance and `ts-proto` for typed stub generation. Both `buf lint` (CI) and `buf generate` (build) are automated. **HTTP vs gRPC comparison (VerifyRepo):** [docs/architecture/http-vs-grpc-github.md](docs/architecture/http-vs-grpc-github.md).

Clean Architecture was considered but deemed too much boilerplate for this scope — see [ADR 002](docs/adr/002-light-modular-monolith.md).

### Tests

- **Unit tests** — cover complex service, client, cache, worker, validator, and event logic
- **Integration tests** — cover all HTTP `/api` endpoints against a Docker app with Postgres, Redis, and local mocks
- **E2E tests** — cover the main page with Playwright against the Docker app

See [testing.md](docs/testing.md) for the one-command test runners.

### Redis Caching

GitHub API responses are cached in Redis with a configurable TTL (default 10 min via `GH_CACHE_TTL_SECONDS`):

- **Repo metadata** (`github:repo:owner/name`) — cached on `POST /api/subscribe` to avoid repeated GitHub calls for the same repo
- **Latest release** (`github:release:owner/name`) — cached during scans; trades up to TTL-delayed notifications for fewer API calls

Cache keys expire automatically; on miss the API is called and the result is stored.

### CI/CD Pipeline

GitHub Actions runs on every push and pull request (`.github/workflows/`):

- **Lint** — Biome checks formatting and code style
- **Test** — Jest unit and integration tests

Deployment to the live server is done separately after CI passes.

Flow: 
Push → Biome Lint & Tests → Build & deploy to Docker Hub → Pull on the VPS

### Extras Implemented

| Extra | Status |
|-------|--------|
| Deploy + HTML subscribe page | ✅ https://github-subscriptions.tweeedlex.xyz |
| gRPC interface | ✅ mirrors REST endpoints; browser proxy included |
| Redis caching with 10 min TTL | ✅ configurable via `GH_CACHE_TTL_SECONDS` |
| API key authentication (`X-API-Key`) | ✅ on `POST /subscribe` and `GET /subscriptions` |
| Prometheus metrics (`/api/metrics`) | ✅ |
| GitHub Actions CI | ✅ lint + tests on every push |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20 + TypeScript |
| HTTP Framework | Fastify |
| RPC Framework | gRPC (`@grpc/grpc-js` + `@grpc/proto-loader`) |
| Proto Lint & Codegen | buf (v2, STANDARD lint) + ts-proto (typed stubs) |
| Database | PostgreSQL + Prisma ORM |
| Cache | Redis (node-redis for cache, IORedis for BullMQ) |
| Job Queue | BullMQ |
| Email | Resend |
| Logger | Pino |
| DI Container | tsyringe |
| Module Boundaries | dependency-cruiser |
| Benchmark | autocannon (HTTP) + `@grpc/grpc-js` loop (gRPC) |
| Tests | Jest + ts-jest + Supertest + Playwright |
| Linter | Biome |
| Container | Docker + Docker Compose |

## Setup

### Prerequisites

- Node.js 20+
- Docker + Docker Compose

### Local Development

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in the values:
   ```bash
   cp .env.example .env
   ```

3. Start infrastructure services:
   ```bash
   docker compose up postgres redis
   ```

4. Install dependencies:
   ```bash
   npm install
   ```

5. Generate Prisma client and run migrations:
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

6. Start the development server:
   ```bash
   npm run dev
   ```

### Running with Docker

Start the complete application (monolith + notification service + their dependencies):
```bash
docker compose up --build
```

The monolith is available at `http://localhost:3000`; the notification service listens on
`3100` (HTTP) and `50061` (gRPC). The monolith reaches it via `NOTIFICATION_TRANSPORT`
(`http` by default).

Docker Compose uses internal service names for container-to-container connections:
`postgres://postgres:postgres@postgres:5432/github-subscriptions` and `redis://redis:6379`.
Keep host-local `.env` values such as `localhost:5432` for commands you run outside Docker.
Override `DOCKER_DATABASE_URL` or `DOCKER_REDIS_URL` only if you intentionally want the containers to connect elsewhere.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection URL |
| `REDIS_URL` | Yes | Redis connection URL |
| `API_KEY` | Yes | API key for protected endpoints |
| `RESEND_API_KEY` | Yes | Resend API key for sending emails |
| `GITHUB_TOKEN` | No | GitHub Personal Access Token (increases rate limit from 60 to 5000/hr) |
| `GITHUB_API_BASE_URL` | No | GitHub API base URL (default: `https://api.github.com`; Docker tests use the local mock) |
| `BASE_URL` | No | Base URL for email links (default: `http://localhost:3000`) |
| `EMAIL_PROVIDER` | No | Email provider implementation: `resend` or `mock` (default: `resend`) |
| `EMAIL_MOCK_URL` | No | Mock email service URL used when `EMAIL_PROVIDER=mock` |
| `PORT` | No | HTTP server port (default: `3000`) |
| `GRPC_PORT` | No | gRPC server port (default: `50051`) |
| `SCAN_INTERVAL_MS` | No | Release scan interval in ms (default: `300000` = 5 min) |
| `GH_CACHE_TTL_SECONDS` | No | GitHub API response cache TTL in seconds (default: `600` = 10 min) |
| `NOTIFICATION_TRANSPORT` | No | How the monolith calls the notification service: `http` or `grpc` (default: `http`) |
| `NOTIFICATION_HTTP_URL` | No | Notification service HTTP base URL (default: `http://localhost:3100`) |
| `NOTIFICATION_GRPC_ADDR` | No | Notification service gRPC address (default: `localhost:50061`) |
| `NOTIFICATION_HTTP_PORT` | No | Notification service HTTP listen port (default: `3100`) |
| `NOTIFICATION_GRPC_PORT` | No | Notification service gRPC listen port (default: `50061`) |

## API Documentation

API contracts are defined in Swagger on the `/docs` endpoint.

### REST Endpoints

| Method | Path | Auth Required | Description |
|--------|------|--------------|-------------|
| `POST` | `/api/subscribe` | Yes (`X-API-Key`) | Subscribe to release notifications |
| `GET` | `/api/confirm/:token` | No | Confirm email subscription |
| `GET` | `/api/unsubscribe/:token` | No | Unsubscribe from notifications |
| `GET` | `/api/subscriptions?email=...` | Yes (`X-API-Key`) | Get active subscriptions for email |
| `POST` | `/api/grpc-proxy` | Yes (`X-API-Key`) | Browser-to-gRPC proxy |
| `GET` | `/api/metrics` | No | Prometheus metrics |

### gRPC Service

Proto definition: `proto/subscription.proto`

| RPC Method | Auth | Description |
|-----------|------|-------------|
| `Subscribe` | `x-api-key` metadata | Subscribe to release notifications |
| `Confirm` | No | Confirm email subscription |
| `Unsubscribe` | No | Unsubscribe from notifications |
| `GetSubscriptions` | `x-api-key` metadata | Get active subscriptions for email |

gRPC server runs on port `50051` (configurable via `GRPC_PORT`).

## Development

### Run tests
```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

### Run linter (Biome + module boundaries)
```bash
npm run lint              # biome check + dependency-cruiser
npm run lint:boundaries   # boundaries only
npm run boundaries:graph  # regenerate docs/architecture/deps.dot
```

### Benchmark HTTP vs gRPC
Start the notification service with the mock email provider, then:
```bash
API_KEY=<key> BENCH_DURATION=10 BENCH_CONNECTIONS=20 npm run bench
# → bench/results/<timestamp>.json + bench/results/latest.json
```
See [docs/architecture/http-vs-grpc.md](docs/architecture/http-vs-grpc.md) for results and conclusions.

### Build
```bash
npm run build
```

### Database migrations
```bash
# Create new migration (dev)
npx prisma migrate dev --name migration_name

# Deploy migrations (production)
npx prisma migrate deploy
```

## How it Works

1. **Subscribe**: User POSTs email + repo slug or link → GitHub repo is verified → subscription is created (unconfirmed) → confirmation email is sent via Resend
2. **Confirm**: User clicks the link in the email → subscription is marked as confirmed
3. **Scan**: Every X minutes, BullMQ processes a repeatable job that fetches all confirmed repos → checks latest release via GitHub API → if tag changed, sends notification emails to all confirmed subscribers
4. **Unsubscribe**: User clicks the link in any notification email → subscription is deleted

## Key Design Decisions

- **`last_seen_tag` is stored on the `Repo` table** (not per-subscription) to avoid data duplication. The `GET /subscriptions` endpoint joins to get this value.
- **Two tokens per subscription**: `confirm_token` (nulled after use) + `unsubscribe_token` (permanent in every email).
- **GitHub API caching**: Repo verification and release data are cached in Redis with a configurable TTL. This reduces GitHub API usage at the cost of up to TTL-delayed release notifications.
- **Rate limit handling**: GitHub `X-RateLimit-*` headers are monitored; scanner stops gracefully on rate limit errors.
- **Dual transport**: REST for browser/standard HTTP clients, gRPC for service-to-service communication. A browser-side gRPC proxy allows the web UI to test both interfaces.

## Documentation

### Architecture Decision Records

| ADR | Decision |
|-----|---------|
| [ADR 001](docs/adr/001-choose-fastify.md) | Use Fastify as the HTTP framework |
| [ADR 002](docs/adr/002-light-modular-monolith.md) | Modular monolith over Clean Architecture |
| [ADR 003](docs/adr/003-use-bullmq.md) | Use BullMQ for job queuing |
| [ADR 004](docs/adr/004-repo-table-last-seen-tag.md) | Store `last_seen_tag` on the Repo table |
| [ADR 006](docs/adr/006-observability-stack.md) | Observability stack |
| [ADR 007](docs/adr/007-di-container-tsyringe.md) | Use tsyringe for dependency injection |
| [ADR 008](docs/adr/008-dependency-cruiser-boundaries.md) | Enforce module boundaries with dependency-cruiser |
| [ADR 009](docs/adr/009-notification-service-extraction.md) | Extract notification into a separate service |
| [ADR 010](docs/adr/010-http-vs-grpc-comparison.md) | HTTP vs gRPC for the notification API |
| [ADR 011](docs/adr/011-github-service-grpc-buf.md) | Extract GitHub service with gRPC + buf |

### Architecture Documentation

| Doc | Contents |
|-----|---------|
| [Module Boundaries](docs/architecture/module-boundaries.md) | Module public APIs, enforced rules, dependency graph |
| [HTTP vs gRPC](docs/architecture/http-vs-grpc.md) | Benchmark results + transport choice (notification service) |
| [HTTP vs gRPC: VerifyRepo](docs/architecture/http-vs-grpc-github.md) | Benchmark results + transport choice (github-service) |

### Domain Documentation

| Doc | Contents |
|-----|---------|
| [Glossary](docs/domain/glossary.md) | Core terms, subscription lifecycle, constraints |
| [Data Model](docs/domain/data-model.md) | Entity relationships, constraints, key queries |
| [Flows](docs/domain/flows.md) | Subscribe, confirm, scan, unsubscribe, email delivery sequence diagrams |

### Comments & Assumptions
- **429 Too Many Requests** error was added to the `/subscribe` endpoint as there is a requirement to handle GitHub API rate limits, and the endpoint uses an API method to check if repo exists.
- I assumed that GitHub API token should be stored in the environment variable. I thought about users providing their own token but there wasn't a field for this in Swagger data contract.
- GitHub API responses are cached in Redis with a configurable TTL. I assumed that I should also add caching to the scanner API calls. This decision has a trade-off: it would slow down the notification process but there would be less GitHub API calls.
