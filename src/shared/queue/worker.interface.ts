import type { JobHandler, WorkerOptions } from './queue.types';
export interface IWorker { close(): Promise<void>; }
export interface IWorkerFactory {
  createWorker<T>(queueName: string, handler: JobHandler<T>, options?: WorkerOptions): IWorker;
}
