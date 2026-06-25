export interface IScheduler {
  scheduleRepeatable(jobName: string, data: unknown, everyMs: number): Promise<void>;
  removeAllRepeatable(): Promise<void>;
  stop(): Promise<void>;
}
