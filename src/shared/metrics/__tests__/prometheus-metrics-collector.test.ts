import { METRIC_DEFINITIONS, METRIC_NAMES } from '../definitions';
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

describe('METRIC_DEFINITIONS', () => {
  it('registers the in-flight gauge', async () => {
    const c = new PrometheusMetricsCollector(METRIC_DEFINITIONS);
    c.incrementGauge(METRIC_NAMES.HTTP_REQUESTS_IN_FLIGHT);
    const { body } = await c.render();
    expect(body).toContain('http_requests_in_flight');
    expect(body).toMatch(/http_requests_in_flight 1\b/);
  });
});
