# ADR 010: HTTP vs gRPC for the Notification API

**Status**: Accepted
**Date**: 2026-06-11

## Context

HW6 required implementing both HTTP and gRPC transports for the notification service ingress and then benchmarking them to make an informed choice. With both transports working and measurable, a default had to be selected.

Full benchmark details and raw results: `docs/architecture/http-vs-grpc.md` and `bench/results/latest.json`.

## Decision

Retain both transports. Default to **HTTP** (`NOTIFICATION_TRANSPORT=http`). gRPC is kept and selectable via the env var.

## Benchmark Summary

Load applied against the fire-and-enqueue ingress (`POST /notifications/send` vs `SendNotification` RPC) with a small fixed payload:

| Transport | Throughput | p50 latency | Errors |
|-----------|-----------|-------------|--------|
| HTTP (Fastify) | ~5.1–5.4k req/s | ~3 ms | 0 |
| gRPC | ~3.5k req/s | ~5 ms | 0 |

Both transports were error-free. The gRPC deficit narrowed on the larger `release` notification payload, consistent with protobuf's serialisation advantage engaging at higher message sizes.

## Alternatives Considered

| Option | Reason rejected |
|--------|----------------|
| Default to gRPC | Lower throughput and higher latency on the actual payload; no compelling advantage for this call shape. |
| Remove HTTP, keep only gRPC | Loses browser/curl debuggability and the performance lead; gRPC adds a proto toolchain dependency for no gain. |
| Remove gRPC, keep only HTTP | Discards a working transport that could be preferable for larger payloads or cross-language consumers. |

## Rationale

For a small-payload, fire-and-enqueue ingress, gRPC's characteristic advantages (binary serialisation, multiplexed streams) do not engage. HTTP is faster, simpler to debug (curl, browser, any HTTP client), and requires no code generation. gRPC retains value for future scenarios: larger notification payloads, higher call frequency, or cross-language service consumers — the narrowing gap on the `release` payload hints at a crossover point that could make gRPC preferable at larger message sizes.

## Consequences

- `NOTIFICATION_TRANSPORT=http` is the default in all compose files and documentation.
- Switching to gRPC requires only changing one env var — no code change.
- Both transports are covered by integration tests so neither bitrotts silently.
- The benchmark harness lives in `bench/` and can be re-run against either transport to track regressions.
