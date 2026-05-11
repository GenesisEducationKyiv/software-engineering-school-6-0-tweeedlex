import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { JobEnqueueError } from '../queue.errors';
import type { IQueueProducer } from '../queue-producer.interface';
import type { JobOptions } from '../queue.types';
import type { ILogger } from '../../logger';

export class BullMQProducer<T> implements IQueueProducer<T> {
  private queue: Queue | null = null;

  constructor(
    private readonly queueName: string,
    private readonly connection: IORedis,
    private readonly logger: ILogger,
  ) {}

  private getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(this.queueName, { connection: this.connection });
    }
    return this.queue;
  }

  async enqueue(jobName: string, data: T, options?: JobOptions): Promise<void> {
    try {
      await this.getQueue().add(jobName, data, options);
    } catch (err) {
      this.logger.error({ err, jobName, queue: this.queueName }, 'Failed to enqueue job');
      throw new JobEnqueueError(`Failed to enqueue ${jobName} in ${this.queueName}`);
    }
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}
