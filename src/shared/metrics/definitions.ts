import type { MetricDef } from './prometheus-metrics-collector';

export const METRIC_NAMES = {
  HTTP_REQUESTS_TOTAL: 'http_requests_total',
  HTTP_REQUEST_DURATION_SECONDS: 'http_request_duration_seconds',
  NOTIFICATIONS_SENT_TOTAL: 'notifications_sent_total',
  GITHUB_API_CALLS_TOTAL: 'github_api_calls_total',
  ACTIVE_SUBSCRIPTIONS: 'active_subscriptions',
  SCAN_RELEASES_TOTAL: 'scan_releases_total',
  NEW_RELEASES_DETECTED_TOTAL: 'new_releases_detected_total',
} as const;

export const METRIC_DEFINITIONS: MetricDef[] = [
  {
    kind: 'counter',
    name: METRIC_NAMES.HTTP_REQUESTS_TOTAL,
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
  },
  {
    kind: 'histogram',
    name: METRIC_NAMES.HTTP_REQUEST_DURATION_SECONDS,
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  },
  {
    kind: 'counter',
    name: METRIC_NAMES.NOTIFICATIONS_SENT_TOTAL,
    help: 'Total notification emails sent',
    labelNames: ['type'],
  },
  {
    kind: 'counter',
    name: METRIC_NAMES.GITHUB_API_CALLS_TOTAL,
    help: 'Total GitHub API calls',
    labelNames: ['endpoint', 'status'],
  },
  {
    kind: 'gauge',
    name: METRIC_NAMES.ACTIVE_SUBSCRIPTIONS,
    help: 'Active confirmed subscriptions',
  },
  { kind: 'counter', name: METRIC_NAMES.SCAN_RELEASES_TOTAL, help: 'Total release scans' },
  {
    kind: 'counter',
    name: METRIC_NAMES.NEW_RELEASES_DETECTED_TOTAL,
    help: 'Total new releases detected',
  },
];
