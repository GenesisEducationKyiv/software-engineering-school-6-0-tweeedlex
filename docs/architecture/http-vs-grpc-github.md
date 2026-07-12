# HTTP/JSON vs gRPC: VerifyRepo Benchmark

**Service:** `github-service`  
**Operation:** `VerifyRepo` (GET /internal/repos/:owner/:name vs VerifyRepo RPC)  
**Date:** 2026-06-21

## Results

| Transport | Req/s | P50 (ms) | P90 (ms) | P99 (ms) | Max (ms) |
|-----------|------:|--------:|---------:|---------:|---------:|
| HTTP/JSON | 4 820 |     3.8  |     6.2  |    12.1  |    28.4  |
| gRPC      | 7 340 |     2.4  |     4.1  |     8.3  |    19.7  |

Configuration: 20 connections, 10 s, local Docker, GitHub API mocked.

## Analysis

The `VerifyRepo` response carries 7 fields including a nested `owner.login` object. Protobuf
binary encoding is ~80 bytes vs ~220 bytes JSON — a ~63 % size reduction. This matters
because JSON parsing scales with byte count while protobuf decode scales with field count.

Under 20 concurrent connections, gRPC delivers **~52 % higher throughput** and **~37 % lower
P50 latency** compared to HTTP/JSON. This contrasts with the HW6 notification benchmark where
the two transports were nearly equal (small, flat payloads).

**Why HTTP wins for notifications:** single-string payloads (email, token) cost almost nothing
to serialize; connection overhead dominates both transports equally.

**Why gRPC wins for VerifyRepo:** nested, multi-field structs amortize protobuf's fixed
per-field decode cost across more data per field.

## Comparison with HW6 Notification Benchmark

| Op              | HTTP Req/s | gRPC Req/s | gRPC advantage |
|-----------------|----------:|----------:|---------------|
| sendConfirmation (HW6) | ~5 400 | ~5 600 | +4 % |
| sendRelease (HW6)      | ~4 900 | ~5 100 | +4 % |
| verifyRepo (HW9)       | ~4 820 | ~7 340 | +52 % |

**Takeaway:** payload complexity determines whether gRPC's binary encoding advantage
materialises. For internal service calls that move structured domain objects (repos, releases),
gRPC is the correct default.

## Reproducing

```bash
# Start github-service with mocked GitHub API
GITHUB_API_BASE_URL=http://localhost:4000/github \
  API_KEY=test-api-key REDIS_URL=redis://localhost:6379 \
  npx ts-node -r tsconfig-paths/register src/services/github/main.ts &

# Run benchmark
API_KEY=test-api-key npm run bench:github
```
