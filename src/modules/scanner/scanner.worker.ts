import { type ConnectionOptions, Worker } from 'bullmq';
import { logger } from '../../config/logger';
import type { ScannerService } from './scanner.service';

export const SCANNER_QUEUE = 'scan-releases';

export class ScannerWorker {
  private readonly worker: Worker;

  constructor(connection: ConnectionOptions, scannerService: ScannerService) {
    this.worker = new Worker(
      SCANNER_QUEUE,
      async () => {
        await scannerService.scanAllRepos();
      },
      {
        connection,
        concurrency: 1, // Only one scan at a time
      },
    );

    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Scanner job completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err }, 'Scanner job failed');
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
