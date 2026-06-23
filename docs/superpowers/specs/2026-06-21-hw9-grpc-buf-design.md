# HW9 — gRPC + buf: Extract GitHub Service

**Date:** 2026-06-21
**Branch:** `hw9-grpc-buf` (off `hw8-orchestrated-saga`)
**Homework:** Service Communication — replace one internal synchronous REST call between two
microservices with gRPC, define the contract in `.proto`, wire `buf`, keep the old REST
implementation alongside, and compare the two.

## Problem / Context

The homework asks to take an existing **synchronous** REST call between two services and
convert it to gRPC. On the current `hw8` branch the monolith ↔ notification path is now
fully **asynchronous** (RabbitMQ saga), so there is no live sync REST inter-service hop to
convert. The only other service collaboration is the GitHub repo logic, which is still an
**in-process** module inside the monolith.

Decision: **extract the `github` module into a standalone `github-service`** so the
monolith→github call becomes a real synchronous inter-service call, then offer it over both
HTTP/JSON and gRPC, switchable at runtime. This produces a genuine REST-vs-gRPC comparison
on a payload (`Repo`) that is larger and more nested than the notification ingress — a useful
contrast to the existing HW6 notification benchmark, where small payloads made HTTP win.

This mirrors the established notification-service extraction pattern (own process, own config
loader, dual transport, `*_TRANSPORT` switch, benchmark + ADR).

## Goals

- `github-service` runs as its own process, owning the GitHub API client + Redis cache.
- The monolith calls it remotely via the **same `IGitHubService` interface** its consumers
  already depend on (`subscriptions`, `scanner`) — consumers unchanged.
- Both transports coexist: HTTP/JSON (Fastify) and gRPC (`@grpc/grpc-js`), selected by
  `GITHUB_TRANSPORT=http|grpc`. **Default `grpc`** (the new impl is the headline); REST kept
  and tested as the fallback (HW rule: do not delete the old implementation).
- `buf` wired for lint + codegen. New `github.proto` generates TS stubs via **ts-proto**;
  existing `notification.proto` / `subscription.proto` are brought under `buf lint` too.
- Benchmark VerifyRepo HTTP vs gRPC; document the comparison (README + ADR + arch doc).

## Non-Goals

- Not rewriting the existing notification / subscription gRPC code to ts-proto. They keep
  runtime `@grpc/proto-loader`; buf only **lints** them. Only `github.proto` uses generated
  stubs.
- Not changing the saga / RabbitMQ async paths.
- Not moving the GitHub domain classes' logic — `github.{client,cache,service,types}.ts` are
  framework-free and are **reused** by `github-service`, not rewritten.

## Architecture

### Before
```
subscription.service ─┐
                      ├─ in-process IGitHubService (GitHubService → GitHubClient + GitHubCache + Redis)
scanner.service ──────┘
```

### After
```
subscription.service ─┐                                   ┌─ GitHubService
                      ├─ IGitHubService (RemoteGitHubClient) ─[HTTP|gRPC]→ github-service ─┤   ├─ GitHubClient (GitHub API)
scanner.service ──────┘     (GITHUB_TRANSPORT)                                              └─ GitHubCache (Redis)
```

The monolith→github-service hop is the "internal synchronous call between two services."
Cache moves server-side; the monolith no longer touches Redis for GitHub.

## Components

### 1. `github-service` process — `src/services/github/`
Mirrors `src/services/notification/`:

- `main.ts` — load config, build graph, start HTTP + gRPC servers, install SIGTERM/SIGINT
  shutdown. (Pattern: `src/services/notification/main.ts`.)
- `container.ts` — build `GitHubService` from `GitHubClient` + `GitHubCache` + own Redis +
  metrics collector (`gh_` prefix). Returns `{ start, close }` graph.
- `config/github-env.ts` — **standalone** loader, no import of `env.ts` (avoids its eager
  `loadConfig()` / `DATABASE_URL` side effect, per the notification-env.ts precedent).
  Fields: `githubToken`, `githubApiBaseUrl`, `redisUrl`, `githubCacheTtlSeconds`,
  `githubHttpPort` (default 3200), `githubGrpcPort` (default 50062), `apiKey`, `nodeEnv`.
- `http/server.ts` — Fastify. Routes:
  - `GET /healthz`
  - `GET /internal/repos/:owner/:name` → `verifyRepo`
  - `GET /internal/repos/:owner/:name/latest-release?bypassCache=` → `getLatestRelease`
  - `x-api-key` guard on the `/internal` routes.
- `grpc/server.ts` — gRPC server for the `github.GitHubService` proto, reusing the existing
  `AppError → grpc.status` mapping idiom from `src/modules/grpc/grpc.server.ts`.

Reuses existing `src/modules/github/{client,cache,service,types}.ts` directly.

### 2. Remote clients in the monolith — `src/modules/github/`
`github.module.ts` stops registering the local `GitHubService` and instead registers a remote
implementation of `IGitHubService`, chosen by `GITHUB_TRANSPORT`:

- `remote/github.http-client.ts` — `GitHubHttpClient`: `fetch` to github-service REST; maps
  HTTP status → `AppError` (preserve `NotFoundError` on 404, `RateLimitError` on 429/403, so
  `subscription.service` / `scanner.service` behaviour is unchanged).
- `remote/github.grpc-client.ts` — `GitHubGrpcClient`: `@grpc/grpc-js` client built from the
  **ts-proto generated stub**; maps `grpc.status` → `AppError`.

Both consumers keep depending on the `GITHUB_SERVICE` token / `IGitHubService` interface — no
change to `subscription.service.ts` or `scanner.service.ts`.

### 3. Contract — `proto/github.proto`
```proto
syntax = "proto3";
package github;

service GitHubService {
  rpc VerifyRepo (VerifyRepoRequest) returns (Repo);
  rpc GetLatestRelease (GetLatestReleaseRequest) returns (LatestReleaseResponse);
}

message VerifyRepoRequest { string owner = 1; string name = 2; }

// Mirrors GitHubRepo from github.types.ts.
message Repo { string full_name = 1; string owner = 2; string name = 3; }

message GetLatestReleaseRequest { string owner = 1; string name = 2; bool bypass_cache = 3; }

message Release {
  string tag_name = 1;
  string name = 2;
  string html_url = 3;
  string published_at = 4;
}

// getLatestRelease can return null; proto3 has no null, so presence is explicit.
message LatestReleaseResponse { bool found = 1; Release release = 2; }
```
`Repo` fields are confirmed against `github.types.ts` during implementation (this is the
expected shape; exact field set is finalized when the proto is written against the real type).

### 4. buf wiring (HW checklist)
- `buf.yaml` — module config, lint = `DEFAULT`.
- `buf.gen.yaml` — codegen via `protoc-gen-ts_proto` (ts-proto) → `src/generated/proto/`.
- `package.json` scripts: `buf:lint`, `buf:generate`; `buf generate` runs as part of `build`.
- Existing `notification.proto` / `subscription.proto` are included under `buf lint`
  (formatting/lint only — they keep runtime `@grpc/proto-loader`).

### 5. Benchmark + docs (HW comparison deliverable, ★)
- Extend `scripts/bench/run.ts` to benchmark `VerifyRepo` over HTTP vs gRPC against a
  containerized github-service with the GitHub API mocked (reuse `tests/mocks`), so it
  measures transport cost, not upstream latency.
- `docs/architecture/http-vs-grpc-github.md` — results table + analysis. Hypothesis: the
  larger/nested `Repo` payload narrows or reverses the HTTP-wins result seen for notification.
- ADR `docs/adr/011-github-service-grpc-buf.md` — why extract, buf adoption, ts-proto choice,
  default transport.
- README: add github-service to the architecture section + the short "what we got, why."

### 6. Deployment
- `Dockerfile.github` (pattern: `Dockerfile.notification`).
- `docker-compose.yml`: add `github` service + its Redis (reuse existing `redis` or add a
  dedicated one — decided during impl), expose HTTP 3200 / gRPC 50062.
- Monolith env: `GITHUB_TRANSPORT`, `GITHUB_SERVICE_HTTP_URL`, `GITHUB_GRPC_ADDR`.

## Data Flow (subscribe, happy path)
1. `POST /api/subscribe` → `subscription.service.subscribe(email, repo)`.
2. `subscription.service` calls `IGitHubService.verifyRepo(owner, name)` →
   `RemoteGitHubClient` → (gRPC default) `VerifyRepo` RPC to github-service.
3. github-service: cache hit → return `Repo`; miss → GitHub API → cache → return `Repo`.
4. Not found → `NotFoundError` (404 / `grpc.status.NOT_FOUND`); rate limited →
   `RateLimitError` (429 / `RESOURCE_EXHAUSTED`). Remote client maps back to the same
   `AppError` the monolith already handles.

## Error Handling
- Reuse `mapAppErrorToGrpcStatus` (400→INVALID_ARGUMENT, 401→UNAUTHENTICATED,
  404→NOT_FOUND, 409→ALREADY_EXISTS, 429→RESOURCE_EXHAUSTED, else INTERNAL).
- Remote clients translate transport errors back into `AppError` so callers are unaffected.
- Network failure to github-service surfaces as `AppError` (5xx / `UNAVAILABLE`); existing
  scanner rate-limit/backoff logic is preserved.

## Testing
- Unit: `GitHubHttpClient` + `GitHubGrpcClient` status→`AppError` mapping; github-service
  HTTP + gRPC handlers (success, not-found, rate-limit, auth).
- Integration: subscribe flow against a containerized github-service, run for **both**
  transports (`GITHUB_TRANSPORT=http` and `grpc`) via `scripts/run-docker-tests.js`.
- buf: `buf lint` passes in CI; `buf generate` produces committed/up-to-date stubs.

## Decisions (resolved)
- **Codegen:** ts-proto (matches existing `@grpc/grpc-js`; minimal new runtime).
- **Default transport:** `grpc` (REST kept + tested as fallback).
- **Extraction scope:** both `verifyRepo` and `getLatestRelease` become remote.
- **Branch:** new `hw9-grpc-buf` off `hw8`.

## Open Items (finalized during implementation)
- Exact `Repo` proto field set vs `GitHubRepo` in `github.types.ts`.
- Dedicated github Redis vs reuse of existing `redis` compose service.
