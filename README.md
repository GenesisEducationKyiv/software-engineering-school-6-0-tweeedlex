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

Code is organized as a **modular monolith** — feature modules (`github`, `subscriptions`, `scanner`, `notifications`) with a shared infrastructure layer (`db`, `redis`, `queue`). Dependencies are injected via constructors. Clean Architecture was considered but deemed too much boilerplate for this scope — see [ADR 002](docs/adr/002-light-modular-monolith.md).

### Tests

- **Unit tests** — cover `GitHubService`, `SubscriptionService`, `ScannerService`, `NotificationService`, gRPC proxy routes
- **Integration tests** — cover all REST endpoints via Supertest with mocked services

Run with:
```bash
npm test
```

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
| Database | PostgreSQL + Prisma ORM |
| Cache | Redis (node-redis for cache, IORedis for BullMQ) |
| Job Queue | BullMQ |
| Email | Resend |
| Logger | Pino |
| Tests | Jest + ts-jest + Supertest |
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

Start the complete application:
```bash
docker compose up --build
```

The app will be available at `http://localhost:3000`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection URL |
| `REDIS_URL` | Yes | Redis connection URL |
| `API_KEY` | Yes | API key for protected endpoints |
| `RESEND_API_KEY` | Yes | Resend API key for sending emails |
| `GITHUB_TOKEN` | No | GitHub Personal Access Token (increases rate limit from 60 to 5000/hr) |
| `BASE_URL` | No | Base URL for email links (default: `http://localhost:3000`) |
| `PORT` | No | HTTP server port (default: `3000`) |
| `GRPC_PORT` | No | gRPC server port (default: `50051`) |
| `SCAN_INTERVAL_MS` | No | Release scan interval in ms (default: `300000` = 5 min) |
| `GH_CACHE_TTL_SECONDS` | No | GitHub API response cache TTL in seconds (default: `600` = 10 min) |

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
npm test
```

### Run linter
```bash
npm run lint
```

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
