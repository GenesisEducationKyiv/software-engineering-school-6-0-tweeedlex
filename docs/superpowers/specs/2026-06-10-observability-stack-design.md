# Observability Stack Design (HW5)

Date: 2026-06-10
Branch: `hw5-nosql-scaling-strategies`
Status: Approved

## Goal

Add production-grade observability to the GitHub release notification service:

1. **Structured logging** shipped to Elasticsearch, searchable/aggregatable in Kibana.
2. **RED metrics** (Rate, Errors, Duration) exported to Prometheus.
3. **Grafana** dashboard visualizing key RED metrics, with Prometheus as datasource.

## Existing Baseline

The app already has a strong observability foundation:

- **Logging** — Pino via `ILogger` interface (`src/shared/logger/`). Child loggers per
  module/component. Pretty output in development, JSON in production, silent in tests.
- **Metrics** — `prom-client` via `IMetricsCollector` (`src/shared/metrics/`). Endpoint
  `GET /api/metrics`. HTTP metrics already RED-shaped:
  - Rate: `http_requests_total{method,route,status}` counter
  - Errors: queryable via the `status` label
  - Duration: `http_request_duration_seconds{method,route,status}` histogram
  - Domain counters: `notifications_sent_total`, `github_api_calls_total`,
    `scan_releases_total`, `new_releases_detected_total`, `active_subscriptions` gauge.
  - Default Node metrics with prefix `github_notifier_`.

**Gaps:** no log shipping pipeline, no request correlation, no in-flight gauge, and none of
Elasticsearch / Kibana / Prometheus / Grafana deployed.

## Architecture

```
app (Fastify) --stdout JSON--> Filebeat --> Elasticsearch <-- Kibana
app /api/metrics <--scrape-- Prometheus <-- Grafana (RED dashboard)
```

- Two compose files sharing one external Docker network `observability`.
  - `docker-compose.yml` (existing) — app joins the `observability` network so Prometheus
    can scrape it and Filebeat can read its container logs.
  - `docker-compose.observability.yml` (new) — Elasticsearch, Kibana, Filebeat, Prometheus,
    Grafana.
- App stays **decoupled**: no app code references ES or a metrics push gateway. Logs go to
  stdout (Pino JSON in production); metrics are pulled from `/api/metrics`.
- **Separation of concerns:** Grafana = metrics (Prometheus). Kibana = logs (Elasticsearch).

## Components

### 1. Application code changes

`src/shared/logger/pino-logger.ts`
- Keep production JSON output. Add base bindings on the root logger: `service` (service name)
  and `env` (NODE_ENV) so every log line is attributable in Kibana.

`src/config/env.ts`
- Add optional `SERVICE_NAME` (default `github-subscriptions-service`) used for log and
  metric labeling.

`src/app.ts` — request correlation + in-flight gauge
- `onRequest` hook: derive `requestId` from `x-request-id` header or `crypto.randomUUID()`.
  Attach a per-request child logger `request.log = logger.child({ requestId, method, url })`.
  Increment the in-flight gauge.
- `onResponse` hook: replace the current flat log line with a structured record
  `{ requestId, method, route, status, durationMs }` logged via the request child logger.
  Keep the existing `http_requests_total` + `http_request_duration_seconds` recording.
  Decrement the in-flight gauge.
- The in-flight gauge must be decremented on every terminal path (use `onResponse`; Fastify
  fires it for both success and error responses).

`src/shared/metrics/definitions.ts`
- Add gauge `http_requests_in_flight` (help: "In-flight HTTP requests", no labels).

### 2. `observability/` directory (config-as-code)

```
observability/
  docker-compose.observability.yml
  filebeat/filebeat.yml
  prometheus/prometheus.yml
  grafana/provisioning/
    datasources/prometheus.yml
    dashboards/dashboards.yml
    dashboards/red-http.json
  README.md
```

- **Elasticsearch** — single node, security disabled for local dev (`xpack.security.enabled=false`),
  on the `observability` network.
- **Kibana** — connected to Elasticsearch; exposes UI on `5601`.
- **Filebeat** — Docker container-log input; decodes the JSON `message` emitted by Pino;
  ships to Elasticsearch index `app-logs-%{+yyyy.MM.dd}`. Mounts the Docker socket and
  container log dir read-only. Filters to the app container only.
- **Prometheus** — scrape job targeting `app:3000/api/metrics` every 15s; UI on `9090`.
- **Grafana** — provisioned Prometheus datasource + auto-loaded RED dashboard; UI on `3001`
  (host) to avoid clashing with the app's `3000`. Default admin password set via env.

### 3. Documentation

- ADR under `docs/adr/` recording the stack choice and the decoupled pull/tail rationale.
- `observability/README.md` with run instructions and verification steps.
- Obsidian vault update (Operations and Deployment + Index) per project memory rules.

## Data Flow

**Logs:** Pino -> stdout -> Docker `json-file` log driver -> Filebeat (container input,
decodes JSON) -> Elasticsearch index `app-logs-*` -> Kibana data view. Searchable and
aggregatable by `requestId`, `module`, `component`, `level`, `status`.

**Metrics:** prom-client registry -> `/api/metrics` -> Prometheus scrape (15s) -> Grafana
PromQL queries.

## RED Dashboard (Grafana, Prometheus datasource)

- **Rate** — `sum(rate(http_requests_total[5m]))` total, and `by (route)`.
- **Errors** — `sum(rate(http_requests_total{status=~"5.."}[5m]))`; error ratio
  `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`.
- **Duration** — `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))`
  for p50/p95/p99.
- **In-flight** — `http_requests_in_flight`.
- **Domain stats** — `rate(notifications_sent_total[5m])`, `rate(github_api_calls_total[5m])`,
  `increase(new_releases_detected_total[1h])`, `active_subscriptions`.

## Error Handling / Resilience

- Filebeat buffers and retries when Elasticsearch is down; logs persist on disk via the
  Docker log driver, so no app log loss.
- Prometheus pull model: scrape failures never affect the app.
- Grafana and Kibana are read-only consumers; their downtime does not affect the app.
- Security disabled across the stack — local/dev scope only, documented as such in the ADR
  and README. Not for production exposure as-is.

## Verification

1. `docker compose -f docker-compose.yml -f observability/docker-compose.observability.yml up`
   (or bring up the shared network + both stacks per README).
2. Generate traffic against the app endpoints.
3. Prometheus: target `app` shows `UP` at `localhost:9090/targets`.
4. Grafana: RED dashboard panels populate at `localhost:3001`.
5. Kibana: `app-logs-*` data view returns logs; filter by a single `requestId` and confirm
   all lines of one request correlate.

## Out of Scope (YAGNI)

- Background-job (BullMQ) RED instrumentation — HTTP is the clearest RED surface; deferred.
- Logstash — Pino already emits clean JSON, so the parse stage is unnecessary.
- ES datasource in Grafana — Kibana is the log UI; metrics/logs stay separated.
- TLS/auth hardening on the stack — local dev scope.
