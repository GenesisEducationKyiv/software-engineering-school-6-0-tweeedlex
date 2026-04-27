import { type ConnectionOptions, Queue } from 'bullmq';
import { logger } from '../../config/logger';
import { SCANNER_QUEUE } from './scanner.worker';

export class ScannerScheduler {
  private readonly queue: Queue;
  private readonly intervalMs: number;

  constructor(connection: ConnectionOptions, intervalMs: number) {
    this.queue = new Queue(SCANNER_QUEUE, { connection });
    this.intervalMs = intervalMs;
  }

  async start(): Promise<void> {
    // Remove existing repeatable jobs to avoid duplicates
    const repeatableJobs = await this.queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    await this.queue.add(
      'scan-releases',
      {},
      {
        repeat: { every: this.intervalMs },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    );

    logger.info({ intervalMs: this.intervalMs }, 'Scanner scheduler started');
  }

  async stop(): Promise<void> {
    const repeatableJobs = await this.queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await this.queue.removeRepeatableByKey(job.key);
    }
    await this.queue.close();
    logger.info('Scanner scheduler stopped');
  }
}
