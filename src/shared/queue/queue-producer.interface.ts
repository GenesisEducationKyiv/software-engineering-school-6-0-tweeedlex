import type { JobOptions } from './queue.types';
export interface IQueueProducer<T> {
  enqueue(jobName: string, data: T, options?: JobOptions): Promise<void>;
  close(): Promise<void>;
}
