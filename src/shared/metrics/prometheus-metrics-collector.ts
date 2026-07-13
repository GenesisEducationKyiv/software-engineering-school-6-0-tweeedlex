import client from 'prom-client';
import type { IMetricsCollector, MetricLabels, MetricsRenderResult } from './metrics.interface';

export type MetricDef =
  | { kind: 'counter'; name: string; help: string; labelNames?: string[] }
  | { kind: 'histogram'; name: string; help: string; labelNames?: string[]; buckets?: number[] }
  | { kind: 'gauge'; name: string; help: string; labelNames?: string[] };

export class PrometheusMetricsCollector implements IMetricsCollector {
  private readonly registry: client.Registry;
  private readonly metrics = new Map<string, client.Counter | client.Histogram | client.Gauge>();

  constructor(defs: MetricDef[], opts?: { defaultMetricsPrefix?: string }) {
    this.registry = new client.Registry();
    client.collectDefaultMetrics({ register: this.registry, prefix: opts?.defaultMetricsPrefix });

    for (const def of defs) {
      if (def.kind === 'counter') {
        this.metrics.set(
          def.name,
          new client.Counter({
            name: def.name,
            help: def.help,
            labelNames: def.labelNames ?? [],
            registers: [this.registry],
          }),
        );
      } else if (def.kind === 'histogram') {
        this.metrics.set(
          def.name,
          new client.Histogram({
            name: def.name,
            help: def.help,
            labelNames: def.labelNames ?? [],
            buckets: def.buckets,
            registers: [this.registry],
          }),
        );
      } else {
        this.metrics.set(
          def.name,
          new client.Gauge({
            name: def.name,
            help: def.help,
            labelNames: def.labelNames ?? [],
            registers: [this.registry],
          }),
        );
      }
    }
  }

  private getMetric(name: string) {
    const m = this.metrics.get(name);
    if (!m) throw new Error(`Metric "${name}" not registered`);
    return m;
  }

  incrementCounter(name: string, labels?: MetricLabels, value = 1): void {
    (this.getMetric(name) as client.Counter).inc(labels ?? {}, value);
  }

  observeHistogram(name: string, value: number, labels?: MetricLabels): void {
    (this.getMetric(name) as client.Histogram).observe(labels ?? {}, value);
  }

  setGauge(name: string, value: number, labels?: MetricLabels): void {
    (this.getMetric(name) as client.Gauge).set(labels ?? {}, value);
  }

  incrementGauge(name: string, labels?: MetricLabels, value = 1): void {
    (this.getMetric(name) as client.Gauge).inc(labels ?? {}, value);
  }

  decrementGauge(name: string, labels?: MetricLabels, value = 1): void {
    (this.getMetric(name) as client.Gauge).dec(labels ?? {}, value);
  }

  async render(): Promise<MetricsRenderResult> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}
