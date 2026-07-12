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
| Grafana       | http://localhost:3001   | login `admin` / `admin` (override via `GRAFANA_ADMIN_PASSWORD`); dashboard "HTTP RED Metrics" |
| Kibana        | http://localhost:5601   | create data view `app-logs-*`          |
| Elasticsearch | http://localhost:9200   | `app-logs-*` indices                   |

## Access & Navigation

Security is disabled across the stack (local/dev only), so only Grafana has a login.

### Grafana — http://localhost:3001

1. Login: user `admin`, password `admin` (or `$GRAFANA_ADMIN_PASSWORD` if you set it before `up`).
   - If prompted to change the password on first login, you can skip it.
   - If `admin/admin` is rejected (password was changed and persisted in the `grafana_data` volume), reset it:
     `docker compose -f observability/docker-compose.observability.yml exec grafana grafana cli admin reset-admin-password admin`
2. Open the dashboard: left sidebar → **Dashboards** → **HTTP RED Metrics** (uid `red-http`).
   - It is auto-provisioned; no import needed.
   - Panels: Rate (req/sec by route), Errors (5xx/sec + ratio), Duration (p50/p95/p99), In-flight, Domain stats.
3. The Prometheus datasource is auto-provisioned (uid `prometheus`). Check it at
   **Connections → Data sources → Prometheus** → **Save & test** → "Data source is working".
4. No data in panels? Generate traffic (see Verify) and confirm Prometheus target is UP.

### Kibana — http://localhost:5601

No login (Elasticsearch security disabled). On first use create the data view:

1. Wait ~30s after startup for Filebeat to ship logs and the `app-logs-*` index to appear.
2. Left menu (☰) → **Stack Management → Data Views → Create data view**.
   - Name/index pattern: `app-logs-*`
   - Timestamp field: `@timestamp`
   - Save.
3. Left menu (☰) → **Discover**, pick the `app-logs-*` data view.
4. Useful searches (the app's Pino JSON is decoded under the `app.*` prefix):
   - One request's full trace: `app.requestId : "verify-7"`
   - Only errors: `app.level : 50`
   - One module: `app.module : "scanner"`
   - Completed HTTP requests: `app.msg : "request completed"`

### Prometheus — http://localhost:9090

No login. **Status → Targets** → job `github-subscriptions-service` should be **UP**.
Try a query in the expression bar: `sum(rate(http_requests_total[5m])) by (route)`.

### Elasticsearch — http://localhost:9200

No login. Raw checks: `curl localhost:9200/_cat/indices/app-logs-*?v` and
`curl localhost:9200/app-logs-*/_count`.

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
- Filebeat selects the app container by the compose label `logfilter: app` (see `docker-compose.yml`), so it keeps working regardless of the image name/tag.
