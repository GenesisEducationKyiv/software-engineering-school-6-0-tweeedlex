# HTTP vs gRPC — Notification Service Benchmark

The notification service (extracted in HW6) exposes the same two operations over
**both** HTTP/JSON (Fastify) and gRPC (`@grpc/grpc-js`). This document compares the two
transports on those operations and records the conclusions.

## What was measured

Each operation is a thin **ingress**: validate the request → enqueue a BullMQ job →
return an acknowledgement. The actual email send happens asynchronously in the worker, so
these numbers reflect **transport + ingress cost (accept → ack)**, not email delivery.

- **confirmation** — small payload (`email`, `confirmToken`, `repo`).
- **release** — larger payload (adds a nested `release` object with `tagName`, `name`,
  `htmlUrl`, `publishedAt`).

Harness: `scripts/bench/run.ts` (`npm run bench`). HTTP is driven by
[`autocannon`](https://github.com/mcollina/autocannon); gRPC by a concurrent timed client
loop using the same duration and connection count. Email provider was `mock` so the worker
never hit the network.

Run parameters: **10 s**, **20 concurrent connections**, notification service in a Docker
container, client on the host. Raw data: [`bench/results/latest.json`](../../bench/results/latest.json).

## Results

| Transport | Operation    | req/s   | p50 (ms) | p90 (ms) | p99 (ms) | max (ms) | errors |
| --------- | ------------ | ------- | -------- | -------- | -------- | -------- | ------ |
| HTTP      | confirmation | 5446.3  | 3        | 4        | 9        | 103      | 0      |
| HTTP      | release      | 5093.6  | 3        | 5        | 7        | 37       | 0      |
| gRPC      | confirmation | 3552.0  | 5.10     | 7.63     | 14.85    | 47.22    | 0      |
| gRPC      | release      | 3487.2  | 5.38     | 7.43     | 12.01    | 42.06    | 0      |

(HTTP latency percentiles are reported by autocannon at millisecond resolution; gRPC
percentiles come from `process.hrtime` and carry sub-millisecond precision.)

## Conclusions

**For this workload, HTTP/JSON won on both throughput and latency.** HTTP sustained
~5.1–5.4k req/s vs gRPC's ~3.5k, with a lower p50 (3 ms vs ~5 ms) and p99.

That result is the opposite of the usual "gRPC is faster" intuition, and the reasons are
specific to what was measured:

1. **The payloads are tiny.** gRPC's main wire advantage — compact binary protobuf vs
   verbose JSON — only pays off on large or deeply nested messages. At a few short string
   fields, serialization size is negligible, so protobuf's encoding cost isn't amortised.
   Tellingly, the larger `release` payload narrowed gRPC's deficit (its p99 improved
   relative to confirmation) — consistent with protobuf scaling better as payloads grow.

2. **The work behind each call is trivial.** Ingress is validate + enqueue. When per-call
   work is ~nothing, the benchmark is dominated by the client/transport's ability to
   saturate connections. `autocannon` is a purpose-built HTTP load generator that pipelines
   aggressively over keep-alive HTTP/1.1; our gRPC loop is a straightforward
   await-one-call-then-next per worker, which leaves the HTTP/2 stream less saturated. Part
   of gRPC's lower throughput here is the client harness, not the protocol.

3. **HTTP/2 framing + protobuf marshalling add fixed per-call overhead** that, for a
   no-op-ish endpoint, isn't offset by any of gRPC's strengths (streaming, multiplexing
   many in-flight RPCs, smaller large-payload encoding).

**When each transport is the right choice:**

- **HTTP/JSON** — ubiquitous, trivially debuggable (curl, browser, Swagger), no codegen.
  Ideal for this service's small, low-complexity ingress and for any browser or third-party
  caller. It is the default transport (`NOTIFICATION_TRANSPORT=http`).
- **gRPC** — wins as payloads grow, when strict schema/codegen and cross-language contracts
  matter, and for streaming or high-fan-out multiplexed RPC. For a chattier or
  larger-message internal API it would likely overtake HTTP; the `release` trend hints at
  the crossover.

**Bottom line for this service:** the notification ingress is small-payload and
fire-and-enqueue, so HTTP is both faster *and* simpler here — gRPC's advantages don't
engage at this message size and call shape. Both transports are kept and switchable via
`NOTIFICATION_TRANSPORT`, so the choice can be revisited if the contract grows.

## Reproducing

```bash
# Start the notification service with the mock email provider, e.g.:
API_KEY=bench-key docker compose up -d --build notif-redis notification
# (override EMAIL_PROVIDER=mock so the worker doesn't call Resend)

API_KEY=bench-key BENCH_DURATION=10 BENCH_CONNECTIONS=20 npm run bench
# → writes bench/results/<timestamp>.json + bench/results/latest.json
```

Tunables (env): `BENCH_HTTP_URL`, `BENCH_GRPC_ADDR`, `BENCH_DURATION`, `BENCH_CONNECTIONS`,
`API_KEY`.
