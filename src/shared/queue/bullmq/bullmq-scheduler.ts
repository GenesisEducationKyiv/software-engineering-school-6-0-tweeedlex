import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import type { ILogger } from '../../logger';
import type { IScheduler } from '../scheduler.interface';

export class BullMQScheduler implements IScheduler {
  private queue: Queue;

  constructor(
    private readonly queueName: string,
    connection: IORedis,
    private readonly logger: ILogger,
  ) {
    this.queue = new Queue(queueName, { connection });
  }

  async scheduleRepeatable(jobName: string, data: unknown, everyMs: number): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }
    await this.queue.add(jobName, data, {
      repeat: { every: everyMs },
      removeOnComplete: 10,
      removeOnFail: 50,
    });
    this.logger.info({ queueName: this.queueName, everyMs }, 'Repeatable job scheduled');
  }

  async removeAllRepeatable(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }

  async stop(): Promise<void> {
    await this.removeAllRepeatable();
    await this.queue.close();
    this.logger.info({ queueName: this.queueName }, 'Scheduler stopped');
  }
}
