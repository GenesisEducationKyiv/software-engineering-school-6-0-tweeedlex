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
