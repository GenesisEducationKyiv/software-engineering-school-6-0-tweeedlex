import client from 'prom-client';

// Initialize default metrics
client.collectDefaultMetrics({ prefix: 'github_notifier_' });

// Custom metrics
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

export const notificationsSentTotal = new client.Counter({
  name: 'notifications_sent_total',
  help: 'Total number of notification emails sent',
  labelNames: ['type'],
});

export const githubApiCallsTotal = new client.Counter({
  name: 'github_api_calls_total',
  help: 'Total number of GitHub API calls',
  labelNames: ['endpoint', 'status'],
});

export const activeSubscriptionsGauge = new client.Gauge({
  name: 'active_subscriptions',
  help: 'Number of active (confirmed) subscriptions',
});

export const scanReleasesTotal = new client.Counter({
  name: 'scan_releases_total',
  help: 'Total number of release scans performed',
});

export const newReleasesDetectedTotal = new client.Counter({
  name: 'new_releases_detected_total',
  help: 'Total number of new releases detected',
});

export const metricsRegistry = client.register;
