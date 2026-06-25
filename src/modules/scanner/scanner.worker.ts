import type { IWorker, IWorkerFactory } from '@/shared/queue';
import type { ScannerService } from './scanner.service';

export const SCANNER_QUEUE = 'scan-releases';
export type ScanJobData = Record<string, never>;

export const buildScannerWorker = (factory: IWorkerFactory, service: ScannerService): IWorker =>
  factory.createWorker<ScanJobData>(
    SCANNER_QUEUE,
    async () => {
      await service.scanAllRepos();
    },
    { concurrency: 1 },
  );
