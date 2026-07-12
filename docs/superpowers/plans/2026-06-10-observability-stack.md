# Observability Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship structured logs to Elasticsearch/Kibana via Filebeat, export RED HTTP metrics to Prometheus, and visualize them in a provisioned Grafana dashboard.

**Architecture:** App stays decoupled. It writes Pino JSON to stdout (Filebeat tails the container log → Elasticsearch) and exposes `/api/metrics` (Prometheus pulls). A new `observability/` compose stack runs Elasticsearch, Kibana, Filebeat, Prometheus, Grafana on a shared external Docker network `observability`. App code gains request correlation (requestId child logger) and an `http_requests_in_flight` gauge.

**Tech Stack:** Node 20, Fastify 4, Pino 9, prom-client 15, Jest (ts-jest), Docker Compose, Elastic Stack 8.x, Prometheus, Grafana.

---

## File Structure

**App code (TDD-covered):**
- `src/shared/metrics/metrics.interface.ts` — add `incrementGauge` / `decrementGauge` to `IMetricsCollector`.
- `src/shared/metrics/prometheus-metrics-collector.ts` — implement the two new gauge methods.
- `src/shared/metrics/definitions.ts` — add `HTTP_REQUESTS_IN_FLIGHT` name + gauge def.
- `src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts` — new unit test.
- `src/config/env.ts` — add `serviceName`.
- `src/shared/logger/pino-logger.ts` — base bindings (`service`, `env`) on root logger.
- `src/app.ts` — request correlation child logger + in-flight gauge inc/dec + structured response log.

**Infra config (no tests, verified by bringing the stack up):**
- `docker-compose.yml` — attach app to external `observability` network; ensure json-file logging.
- `observability/docker-compose.observability.yml`
- `observability/filebeat/filebeat.yml`
- `observability/prometheus/prometheus.yml`
- `observability/grafana/provisioning/datasources/prometheus.yml`
- `observability/grafana/provisioning/dashboards/dashboards.yml`
- `observability/grafana/provisioning/dashboards/red-http.json`
- `observability/README.md`
- `docs/adr/006-observability-stack.md`
- `.env.example` — add `SERVICE_NAME`.

**Testing note:** Project normally runs tests in Docker (`npm run test:unit`). The new collector test is pure (no DB/Redis), so run it directly with `npx jest --config jest.unit.config.js <path>`. If the local toolchain rejects that, fall back to `npm run test:unit`.

---

## Task 1: In-flight gauge — collector inc/dec methods

**Files:**
- Modify: `src/shared/metrics/metrics.interface.ts:6-11`
- Modify: `src/shared/metrics/prometheus-metrics-collector.ts:67-69`
- Test: `src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts`:

```typescript
import { PrometheusMetricsCollector } from '../prometheus-metrics-collector';
import type { MetricDef } from '../prometheus-metrics-collector';

const defs: MetricDef[] = [
  { kind: 'counter', name: 'test_total', help: 'test counter', labelNames: ['k'] },
  { kind: 'gauge', name: 'test_inflight', help: 'test gauge' },
  { kind: 'histogram', name: 'test_dur', help: 'test hist', buckets: [0.1, 1] },
];

describe('PrometheusMetricsCollector', () => {
  it('increments and decrements a gauge net to expected value', async () => {
    const c = new PrometheusMetricsCollector(defs);
    c.incrementGauge('test_inflight');
    c.incrementGauge('test_inflight');
    c.decrementGauge('test_inflight');
    const { body } = await c.render();
    expect(body).toMatch(/test_inflight 1\b/);
  });

  it('renders counter with labels', async () => {
    const c = new PrometheusMetricsCollector(defs);
    c.incrementCounter('test_total', { k: 'v' });
    const { body } = await c.render();
    expect(body).toMatch(/test_total\{k="v"\} 1\b/);
  });

  it('throws for an unregistered metric', () => {
    const c = new PrometheusMetricsCollector(defs);
    expect(() => c.incrementGauge('nope')).toThrow('Metric "nope" not registered');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.unit.config.js src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts`
Expected: FAIL — `incrementGauge` / `decrementGauge` do not exist on the collector (TS compile error or runtime `not a function`).

- [ ] **Step 3: Add methods to the interface**

In `src/shared/metrics/metrics.interface.ts`, extend `IMetricsCollector`:

```typescript
export interface IMetricsCollector {
  incrementCounter(name: string, labels?: MetricLabels, value?: number): void;
  observeHistogram(name: string, value: number, labels?: MetricLabels): void;
  setGauge(name: string, value: number, labels?: MetricLabels): void;
  incrementGauge(name: string, labels?: MetricLabels, value?: number): void;
  decrementGauge(name: string, labels?: MetricLabels, value?: number): void;
  render(): Promise<MetricsRenderResult>;
}
```

- [ ] **Step 4: Implement methods in the collector**

In `src/shared/metrics/prometheus-metrics-collector.ts`, after the `setGauge` method (around line 69), add:

```typescript
  incrementGauge(name: string, labels?: MetricLabels, value = 1): void {
    (this.getMetric(name) as client.Gauge).inc(labels ?? {}, value);
  }

  decrementGauge(name: string, labels?: MetricLabels, value = 1): void {
    (this.getMetric(name) as client.Gauge).dec(labels ?? {}, value);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest --config jest.unit.config.js src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/metrics/metrics.interface.ts src/shared/metrics/prometheus-metrics-collector.ts src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts
git commit -m "feat(metrics): add gauge inc/dec to collector"
```

---

## Task 2: Register the `http_requests_in_flight` gauge

**Files:**
- Modify: `src/shared/metrics/definitions.ts:3-50`
- Test: `src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts`:

```typescript
import { METRIC_DEFINITIONS, METRIC_NAMES } from '../definitions';

describe('METRIC_DEFINITIONS', () => {
  it('registers the in-flight gauge', async () => {
    const c = new PrometheusMetricsCollector(METRIC_DEFINITIONS);
    c.incrementGauge(METRIC_NAMES.HTTP_REQUESTS_IN_FLIGHT);
    const { body } = await c.render();
    expect(body).toContain('http_requests_in_flight');
    expect(body).toMatch(/http_requests_in_flight 1\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.unit.config.js src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts`
Expected: FAIL — `METRIC_NAMES.HTTP_REQUESTS_IN_FLIGHT` is `undefined`.

- [ ] **Step 3: Add the name**

In `src/shared/metrics/definitions.ts`, add to `METRIC_NAMES`:

```typescript
  HTTP_REQUESTS_IN_FLIGHT: 'http_requests_in_flight',
```

- [ ] **Step 4: Add the gauge definition**

In `src/shared/metrics/definitions.ts`, add to the `METRIC_DEFINITIONS` array (after the HTTP duration histogram entry):

```typescript
  {
    kind: 'gauge',
    name: METRIC_NAMES.HTTP_REQUESTS_IN_FLIGHT,
    help: 'In-flight HTTP requests',
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest --config jest.unit.config.js src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 6: Commit**

```bash
git add src/shared/metrics/definitions.ts src/shared/metrics/__tests__/prometheus-metrics-collector.test.ts
git commit -m "feat(metrics): register http_requests_in_flight gauge"
```

---

## Task 3: Service name in config

**Files:**
- Modify: `src/config/env.ts:1-17,27-45`
- Modify: `.env.example`

- [ ] **Step 1: Add the field to the Config interface**

In `src/config/env.ts`, add to the `Config` interface (after `emailFrom`):

```typescript
  serviceName: string;
```

- [ ] **Step 2: Load it**

In `loadConfig()`, add (after the `emailFrom` line):

```typescript
    serviceName: process.env.SERVICE_NAME || 'github-subscriptions-service',
```

- [ ] **Step 3: Document the env var**

Append to `.env.example`:

```
SERVICE_NAME=github-subscriptions-service
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "feat(config): add SERVICE_NAME"
```

---

## Task 4: Root logger base bindings

**Files:**
- Modify: `src/shared/logger/pino-logger.ts:7-18`
- Modify: `src/main.ts:10-13`

- [ ] **Step 1: Accept base bindings in PinoLogger.create**

In `src/shared/logger/pino-logger.ts`, change the `create` signature and body:

```typescript
  static create(opts: { level: string; pretty: boolean; base?: Record<string, unknown> }): PinoLogger {
    const logger = pino({
      level: opts.level,
      base: opts.base,
      transport: opts.pretty
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          }
        : undefined,
    });
    return new PinoLogger(logger);
  }
```

Note: passing `base` to Pino replaces the default `{pid, hostname}` base. That is intended — we want stable `service`/`env` fields for Kibana. In pretty (dev) mode `pid,hostname` are already ignored, so output is unchanged there.

- [ ] **Step 2: Pass bindings from main.ts**

In `src/main.ts`, update the root logger creation:

```typescript
  const rootLogger = PinoLogger.create({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    pretty: config.nodeEnv === 'development',
    base: { service: config.serviceName, env: config.nodeEnv },
  });
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/shared/logger/pino-logger.ts src/main.ts
git commit -m "feat(logger): add service/env base bindings"
```

---

## Task 5: Request correlation + in-flight gauge in the HTTP app

**Files:**
- Modify: `src/app.ts:1-18,73-89`

- [ ] **Step 1: Add requestId typing and import**

In `src/app.ts`, add the import at the top (after the existing node import):

```typescript
import { randomUUID } from 'node:crypto';
```

Extend the Fastify request module augmentation:

```typescript
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
    requestId?: string;
    log: import('@/shared/logger').ILogger;
  }
}
```

Note: Fastify already declares `request.log` as its own pino instance. Re-declaring the type here narrows it to our `ILogger`; we assign our child logger in the onRequest hook so the runtime value matches. Keep `deps.logger.info(...)` only inside hooks, never `request.log` before it is assigned.

- [ ] **Step 2: Replace the onRequest hook**

In `src/app.ts`, replace the existing `onRequest` hook (the `request.startTime = Date.now()` block) with:

```typescript
  fastify.addHook('onRequest', (request, _reply, done) => {
    request.startTime = Date.now();
    const headerId = request.headers['x-request-id'];
    request.requestId = typeof headerId === 'string' && headerId ? headerId : randomUUID();
    request.log = deps.logger.child({
      requestId: request.requestId,
      method: request.method,
      url: request.url,
    });
    deps.metrics.incrementGauge(METRIC_NAMES.HTTP_REQUESTS_IN_FLIGHT);
    done();
  });
```

- [ ] **Step 3: Replace the onResponse hook**

In `src/app.ts`, replace the existing `onResponse` hook with:

```typescript
  fastify.addHook('onResponse', (request, reply, done) => {
    const duration = (Date.now() - (request.startTime ?? Date.now())) / 1000;
    const labels = {
      method: request.method,
      route: request.routerPath ?? request.url,
      status: String(reply.statusCode),
    };
    deps.metrics.incrementCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL, labels);
    deps.metrics.observeHistogram(METRIC_NAMES.HTTP_REQUEST_DURATION_SECONDS, duration, labels);
    deps.metrics.decrementGauge(METRIC_NAMES.HTTP_REQUESTS_IN_FLIGHT);
    (request.log ?? deps.logger).info(
      {
        requestId: request.requestId,
        method: request.method,
        route: request.routerPath ?? request.url,
        status: reply.statusCode,
        durationMs: Math.round(duration * 1000),
      },
      'request completed',
    );
    done();
  });
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS (no regressions; collector tests included).

- [ ] **Step 6: Manual smoke check**

Run (in one shell): `npm run dev`
In another: `curl -s -H 'x-request-id: test-123' localhost:3000/api/metrics > /dev/null && curl -s localhost:3000/api/metrics | grep http_requests_in_flight`
Expected: `http_requests_in_flight` line present (value `0` after the request completes); dev console shows a structured `request completed` log.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts
git commit -m "feat(http): request correlation id + in-flight gauge"
```

---

## Task 6: Attach the app to the shared observability network

**Files:**
- Modify: `docker-compose.yml:17-39,71-73`

- [ ] **Step 1: Add SERVICE_NAME to the app env and join the network**

In `docker-compose.yml`, under `services.app.environment`, add:

```yaml
      SERVICE_NAME: ${SERVICE_NAME:-github-subscriptions-service}
```

Under `services.app`, add a `networks` key and explicit json-file logging:

```yaml
    networks:
      - default
      - observability
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'
```

- [ ] **Step 2: Declare the external network**

At the bottom of `docker-compose.yml`, add a top-level `networks` block:

```yaml
networks:
  observability:
    external: true
```

Note: `volumes:` already exists at the bottom — add `networks:` as a sibling, do not nest.

- [ ] **Step 3: Validate compose syntax**

Run: `docker compose -f docker-compose.yml config > /dev/null`
Expected: no error (the `external: true` network need not exist yet for `config` to parse; it is created in Task 11).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore(compose): join app to observability network"
```

---

## Task 7: Prometheus config

**Files:**
- Create: `observability/prometheus/prometheus.yml`

- [ ] **Step 1: Write the scrape config**

Create `observability/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'github-subscriptions-service'
    metrics_path: /api/metrics
    static_configs:
      - targets: ['app:3000']
        labels:
          service: 'github-subscriptions-service'
```

Note: `app` is the service name on the shared `observability` network; Prometheus resolves it via Docker DNS.

- [ ] **Step 2: Commit**

```bash
git add observability/prometheus/prometheus.yml
git commit -m "feat(observability): prometheus scrape config"
```

---

## Task 8: Filebeat config

**Files:**
- Create: `observability/filebeat/filebeat.yml`

- [ ] **Step 1: Write the Filebeat config**

Create `observability/filebeat/filebeat.yml`:

```yaml
filebeat.inputs:
  - type: filestream
    id: docker-container-logs
    paths:
      - /var/lib/docker/containers/*/*.log
    parsers:
      - container: ~
    processors:
      - add_docker_metadata:
          host: 'unix:///var/run/docker.sock'

processors:
  # Keep only logs from the app container; drop the rest of the stack's noise.
  - drop_event:
      when:
        not:
          contains:
            container.image.name: 'github-subscriptions-service'
  # Pino writes JSON to stdout; the container parser puts it in `message`. Decode it.
  - decode_json_fields:
      fields: ['message']
      target: 'app'
      overwrite_keys: true
      add_error_key: true

output.elasticsearch:
  hosts: ['http://elasticsearch:9200']
  index: 'app-logs-%{+yyyy.MM.dd}'

setup.template.name: 'app-logs'
setup.template.pattern: 'app-logs-*'
setup.ilm.enabled: false

logging.level: info
```

Note: `setup.ilm.enabled: false` is required when using a custom index name without ILM.

- [ ] **Step 2: Commit**

```bash
git add observability/filebeat/filebeat.yml
git commit -m "feat(observability): filebeat config tailing app container logs"
```

---

## Task 9: Grafana provisioning (datasource + dashboard loader + RED dashboard)

**Files:**
- Create: `observability/grafana/provisioning/datasources/prometheus.yml`
- Create: `observability/grafana/provisioning/dashboards/dashboards.yml`
- Create: `observability/grafana/provisioning/dashboards/red-http.json`

- [ ] **Step 1: Datasource provisioning**

Create `observability/grafana/provisioning/datasources/prometheus.yml`:

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
```

- [ ] **Step 2: Dashboard provider**

Create `observability/grafana/provisioning/dashboards/dashboards.yml`:

```yaml
apiVersion: 1

providers:
  - name: 'RED dashboards'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /etc/grafana/provisioning/dashboards
```

- [ ] **Step 3: RED dashboard JSON**

Create `observability/grafana/provisioning/dashboards/red-http.json`:

```json
{
  "uid": "red-http",
  "title": "HTTP RED Metrics",
  "tags": ["red", "http"],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "10s",
  "time": { "from": "now-15m", "to": "now" },
  "templating": { "list": [] },
  "panels": [
    {
      "id": 1,
      "type": "timeseries",
      "title": "Rate — requests/sec (by route)",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(rate(http_requests_total[5m])) by (route)",
          "legendFormat": "{{route}}"
        }
      ]
    },
    {
      "id": 2,
      "type": "timeseries",
      "title": "Errors — 5xx/sec and error ratio",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(rate(http_requests_total{status=~\"5..\"}[5m]))",
          "legendFormat": "5xx/sec"
        },
        {
          "refId": "B",
          "expr": "sum(rate(http_requests_total{status=~\"5..\"}[5m])) / clamp_min(sum(rate(http_requests_total[5m])), 1e-9)",
          "legendFormat": "error ratio"
        }
      ]
    },
    {
      "id": 3,
      "type": "timeseries",
      "title": "Duration — p50/p95/p99 (seconds)",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 8 },
      "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "targets": [
        {
          "refId": "A",
          "expr": "histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))",
          "legendFormat": "p50"
        },
        {
          "refId": "B",
          "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))",
          "legendFormat": "p95"
        },
        {
          "refId": "C",
          "expr": "histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))",
          "legendFormat": "p99"
        }
      ]
    },
    {
      "id": 4,
      "type": "stat",
      "title": "In-flight requests",
      "gridPos": { "h": 8, "w": 6, "x": 12, "y": 8 },
      "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "targets": [
        { "refId": "A", "expr": "sum(http_requests_in_flight)", "legendFormat": "in-flight" }
      ]
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "Domain — notifications / GitHub API / releases",
      "gridPos": { "h": 8, "w": 6, "x": 18, "y": 8 },
      "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(rate(notifications_sent_total[5m]))",
          "legendFormat": "notifications/sec"
        },
        {
          "refId": "B",
          "expr": "sum(rate(github_api_calls_total[5m]))",
          "legendFormat": "github calls/sec"
        },
        {
          "refId": "C",
          "expr": "sum(increase(new_releases_detected_total[1h]))",
          "legendFormat": "new releases/1h"
        }
      ]
    }
  ]
}
```

Note: `${DS_PROMETHEUS}` resolves to the provisioned default Prometheus datasource. Because the datasource in Step 1 is the default and the only Prometheus source, Grafana binds these panels to it automatically on load.

- [ ] **Step 4: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('observability/grafana/provisioning/dashboards/red-http.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add observability/grafana/provisioning
git commit -m "feat(observability): grafana datasource + RED dashboard provisioning"
```

---

## Task 10: Observability compose stack

**Files:**
- Create: `observability/docker-compose.observability.yml`

- [ ] **Step 1: Write the stack**

Create `observability/docker-compose.observability.yml`:

```yaml
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.13.4
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports:
      - '9200:9200'
    volumes:
      - es_data:/usr/share/elasticsearch/data
    healthcheck:
      test: ['CMD-SHELL', 'curl -s http://localhost:9200/_cluster/health | grep -q .']
      interval: 15s
      timeout: 10s
      retries: 10
    networks:
      - observability

  kibana:
    image: docker.elastic.co/kibana/kibana:8.13.4
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    ports:
      - '5601:5601'
    depends_on:
      elasticsearch:
        condition: service_healthy
    networks:
      - observability

  filebeat:
    image: docker.elastic.co/beats/filebeat:8.13.4
    user: root
    command: ['--strict.perms=false']
    volumes:
      - ./filebeat/filebeat.yml:/usr/share/filebeat/filebeat.yml:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    depends_on:
      elasticsearch:
        condition: service_healthy
    networks:
      - observability

  prometheus:
    image: prom/prometheus:v2.53.0
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    ports:
      - '9090:9090'
    networks:
      - observability

  grafana:
    image: grafana/grafana:11.1.0
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin}
      - GF_USERS_ALLOW_SIGN_UP=false
    ports:
      - '3001:3000'
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - grafana_data:/var/lib/grafana
    depends_on:
      - prometheus
    networks:
      - observability

volumes:
  es_data:
  prometheus_data:
  grafana_data:

networks:
  observability:
    external: true
```

Note: Grafana's internal port stays 3000; host port is 3001 to avoid clashing with the app.

- [ ] **Step 2: Validate compose syntax**

Run: `docker compose -f observability/docker-compose.observability.yml config > /dev/null`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add observability/docker-compose.observability.yml
git commit -m "feat(observability): elasticsearch/kibana/filebeat/prometheus/grafana stack"
```

---

## Task 11: Docs — ADR + observability README

**Files:**
- Create: `docs/adr/006-observability-stack.md`
- Create: `observability/README.md`

- [ ] **Step 1: Write the ADR**

Create `docs/adr/006-observability-stack.md`:

```markdown
# ADR 006: Observability Stack

## Status
Accepted

## Context
The service had structured Pino logging and prom-client metrics with a `/api/metrics`
endpoint, but no way to search logs centrally or visualize metrics over time.

## Decision
Add a decoupled observability stack:

- **Logs:** Pino JSON to stdout → Filebeat tails the Docker container log → Elasticsearch →
  Kibana. The app has no knowledge of Elasticsearch.
- **Metrics:** prom-client `/api/metrics` is scraped by Prometheus (pull model) → visualized
  in Grafana with a provisioned RED dashboard.
- **RED:** HTTP layer exposes Rate (`http_requests_total`), Errors (`status` label),
  Duration (`http_request_duration_seconds`), plus an `http_requests_in_flight` gauge.
- Stack runs in a separate compose file on a shared external `observability` network.

## Alternatives Considered
- **Pino → Elasticsearch directly:** couples the app to ES availability; log loss on ES
  downtime. Rejected.
- **Filebeat → Logstash → ES:** Pino already emits clean JSON, so a Logstash parse stage is
  unnecessary. Rejected for now.
- **Grafana querying Elasticsearch too:** Kibana is the log UI; metrics and logs stay
  separated to match the assignment's tooling.

## Consequences
- App stays decoupled; observability backends can fail without affecting request handling.
- Security is disabled across the stack — local/dev scope only. Not production-safe as-is.
- Filebeat needs read access to the Docker socket and container log directory.
```

- [ ] **Step 2: Write the run README**

Create `observability/README.md`:

```markdown
# Observability Stack

Structured logs → Elasticsearch/Kibana (via Filebeat). RED metrics → Prometheus → Grafana.

## Run

```bash
# 1. Create the shared network (once)
docker network create observability

# 2. Start the app stack (joins the observability network)
docker compose up -d --build

# 3. Start the observability stack
docker compose -f observability/docker-compose.observability.yml up -d
```

## URLs

| Tool          | URL                     | Notes                                  |
| ------------- | ----------------------- | -------------------------------------- |
| App           | http://localhost:3000   | `/api/metrics` exposes Prometheus data |
| Prometheus    | http://localhost:9090   | check `/targets` → `app` is `UP`       |
| Grafana       | http://localhost:3001   | login `admin` / `${GRAFANA_ADMIN_PASSWORD:-admin}`; dashboard "HTTP RED Metrics" |
| Kibana        | http://localhost:5601   | create data view `app-logs-*`          |
| Elasticsearch | http://localhost:9200   | `app-logs-*` indices                   |

## Verify

1. Generate traffic: `for i in $(seq 1 50); do curl -s localhost:3000/api/metrics > /dev/null; done`
2. Prometheus `/targets`: `app` job is `UP`.
3. Grafana → HTTP RED Metrics: Rate / Errors / Duration / In-flight panels populate.
4. Kibana → Discover → `app-logs-*`: filter `app.requestId : "<id>"` and confirm all log
   lines of one request share the id.

## Notes

- Security is disabled (local/dev only). Do not expose these ports publicly.
- Logs are decoded under the `app.*` prefix in Elasticsearch (see `filebeat.yml`
  `decode_json_fields.target: app`).
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/006-observability-stack.md observability/README.md
git commit -m "docs(observability): ADR + run/verify README"
```

---

## Task 12: End-to-end stack verification

**Files:** none (verification only).

- [ ] **Step 1: Create the shared network**

Run: `docker network create observability`
Expected: prints a network id (or "already exists" — fine).

- [ ] **Step 2: Bring up both stacks**

Run:
```bash
docker compose up -d --build
docker compose -f observability/docker-compose.observability.yml up -d
```
Expected: all containers start; `docker compose -f observability/docker-compose.observability.yml ps` shows elasticsearch healthy.

- [ ] **Step 3: Generate traffic**

Run: `for i in $(seq 1 50); do curl -s -H "x-request-id: verify-$i" localhost:3000/api/metrics > /dev/null; done`
Expected: completes without error.

- [ ] **Step 4: Verify Prometheus target**

Run: `curl -s 'localhost:9090/api/v1/targets' | grep -o '"health":"[a-z]*"' | head -1`
Expected: `"health":"up"`.

- [ ] **Step 5: Verify a RED metric is scraped**

Run: `curl -s 'localhost:9090/api/v1/query?query=http_requests_total' | grep -o '"status":"success"'`
Expected: `"status":"success"` and a non-empty result.

- [ ] **Step 6: Verify Grafana dashboard provisioned**

Run: `curl -s -u admin:${GRAFANA_ADMIN_PASSWORD:-admin} localhost:3001/api/dashboards/uid/red-http | grep -o '"title":"HTTP RED Metrics"'`
Expected: `"title":"HTTP RED Metrics"`.

- [ ] **Step 7: Verify logs reach Elasticsearch**

Run (allow ~30s after traffic for Filebeat to ship): `curl -s 'localhost:9200/app-logs-*/_count' | grep -o '"count":[0-9]*'`
Expected: `"count":<n>` with n > 0.

- [ ] **Step 8: Verify request correlation in logs**

Run: `curl -s 'localhost:9200/app-logs-*/_search?q=app.requestId:verify-1' | grep -o '"requestId":"verify-1"' | head -1`
Expected: `"requestId":"verify-1"`.

- [ ] **Step 9: Tear down (optional)**

Run:
```bash
docker compose -f observability/docker-compose.observability.yml down
docker compose down
```

- [ ] **Step 10: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(observability): verification fixes"
```

---

## Post-Implementation: Vault Update

Per project memory rules, after the stack works, update the Obsidian vault:
- `My Project Deep Dive/Operations and Deployment.md` — new observability stack, ports, run commands, the `http_requests_in_flight` metric, request correlation logging.
- `Index.md` — note HW5 observability work on `hw5-nosql-scaling-strategies`.
