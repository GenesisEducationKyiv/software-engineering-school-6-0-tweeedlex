export interface JobOptions {
  attempts?: number;
  backoff?: { type: 'exponential' | 'fixed'; delay: number };
  delay?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
  jobId?: string;
}
export interface Job<T> {
  readonly id: string | undefined;
  readonly name: string;
  readonly data: T;
  readonly attemptsMade: number;
}
export type JobHandler<T> = (job: Job<T>) => Promise<void>;
export interface WorkerOptions {
  concurrency?: number;
}
