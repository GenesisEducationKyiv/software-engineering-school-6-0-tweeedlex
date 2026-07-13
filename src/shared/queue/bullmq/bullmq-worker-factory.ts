import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type { ILogger } from '../../logger';
import type { JobHandler, WorkerOptions } from '../queue.types';
import type { IWorker, IWorkerFactory } from '../worker.interface';

export class BullMQWorkerFactory implements IWorkerFactory {
  constructor(
    private readonly connection: IORedis,
    private readonly logger: ILogger,
  ) {}

  createWorker<T>(queueName: string, handler: JobHandler<T>, options?: WorkerOptions): IWorker {
    const workerOptions = options?.concurrency ? { concurrency: options.concurrency } : {};
    const worker = new Worker<T>(
      queueName,
      async (job) => {
        await handler({
          id: job.id,
          name: job.name,
          data: job.data,
          attemptsMade: job.attemptsMade,
        });
      },
      { connection: this.connection, ...workerOptions },
    );

    worker.on('completed', (job) => {
      this.logger.info({ jobId: job.id, queue: queueName }, 'Job completed');
    });

    worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err, queue: queueName }, 'Job failed');
    });

    return { close: () => worker.close() };
  }
}
