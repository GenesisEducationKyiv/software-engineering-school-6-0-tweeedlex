# ADR 011 — Extract GitHub Module as gRPC Microservice with buf

**Date:** 2026-06-21  
**Status:** Accepted  
**Branch:** `hw9-grpc-buf`

## Context

HW9 requires replacing an internal synchronous REST call between two services with gRPC. On
the `hw8` branch, the only remaining synchronous dependency is the GitHub module, which runs
in-process inside the monolith. To create a genuine inter-service call, we extract it as a
standalone `github-service`.

## Decision

1. **Extract `github-service`** as a separate process that owns the GitHub API client and Redis
   cache. The monolith calls it remotely via the same `IGitHubService` interface its consumers
   already use — `subscription.service` and `scanner.service` are unchanged.

2. **Dual transport**: `github-service` exposes both HTTP/JSON (Fastify, port 3200) and gRPC
   (`@grpc/grpc-js`, port 50062). The monolith selects via `GITHUB_TRANSPORT=http|grpc`
   (default: `grpc`).

3. **buf for lint + codegen**: `buf.yaml` (v2, STANDARD lint) governs all protos in `proto/`.
   `buf.gen.yaml` generates TypeScript stubs via `ts-proto` with `outputServices=grpc-js`.
   This is added to the `build` script so stubs are always fresh.

4. **ts-proto** for the github proto only. The existing `notification.proto` and
   `subscription.proto` remain under `@grpc/proto-loader` (runtime loading). Only
   `github.proto` benefits from typed stubs — adding ts-proto to all protos would be a
   separate migration.

## Consequences

- `subscription.service` and `scanner.service` require no changes.
- Cache moves server-side; the monolith no longer touches Redis for GitHub data.
- The `github.module.ts` now wires either `GitHubHttpClient` or `GitHubGrpcClient` based on
  the `GITHUB_TRANSPORT` env var.
- `buf lint` runs in CI; `buf generate` is part of the build pipeline.
- New environment variables: `GITHUB_TRANSPORT`, `GITHUB_SERVICE_HTTP_URL`, `GITHUB_GRPC_ADDR`.
