# VerifyRepo Benchmark: HTTP/JSON vs gRPC

**Date:** 2026-06-21  
**Duration:** 10s | **Connections:** 20 | **Machine:** local Docker

## Results

| Transport | Req/s | P50 (ms) | P90 (ms) | P99 (ms) | Max (ms) | Errors |
|-----------|------:|--------:|---------:|---------:|---------:|-------:|
| HTTP/JSON | 4 820 |     3.8  |     6.2  |    12.1  |    28.4  |      0 |
| gRPC      | 7 340 |     2.4  |     4.1  |     8.3  |    19.7  |      0 |

**gRPC advantage:** ~52 % higher throughput, ~37 % lower P50 latency.

## Analysis

Unlike the HW6 notification benchmark where HTTP and gRPC were comparable (small payload,
single string fields), the `VerifyRepo` response carries a richer shape: 7 fields including
nested `owner.login`. Protobuf binary encoding is measurably smaller (~80 bytes vs ~220 bytes
JSON) and skips JSON parsing on both sides — this drives a clear gRPC win for this payload.

**HTTP** remains the simpler fallback: human-readable, curl-testable, no stub generation
required. The `GITHUB_TRANSPORT=http` switch keeps it operational.

**Conclusion:** gRPC is the right default for internal `VerifyRepo` calls; the gain compounds
under load because binary decode is cheaper per CPU cycle than JSON parse.

## Reproducing

```bash
# Start github-service (with GitHub API mocked)
GITHUB_API_BASE_URL=http://localhost:4000/github API_KEY=test-api-key \
  REDIS_URL=redis://localhost:6379 \
  npx ts-node -r tsconfig-paths/register src/services/github/main.ts &

# Run benchmark
API_KEY=test-api-key npm run bench:github
```
