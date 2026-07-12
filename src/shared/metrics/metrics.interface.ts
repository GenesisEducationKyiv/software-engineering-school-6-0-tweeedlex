export type MetricLabels = Record<string, string | number>;
export interface MetricsRenderResult {
  contentType: string;
  body: string;
}
export interface IMetricsCollector {
  incrementCounter(name: string, labels?: MetricLabels, value?: number): void;
  observeHistogram(name: string, value: number, labels?: MetricLabels): void;
  setGauge(name: string, value: number, labels?: MetricLabels): void;
  incrementGauge(name: string, labels?: MetricLabels, value?: number): void;
  decrementGauge(name: string, labels?: MetricLabels, value?: number): void;
  render(): Promise<MetricsRenderResult>;
}
