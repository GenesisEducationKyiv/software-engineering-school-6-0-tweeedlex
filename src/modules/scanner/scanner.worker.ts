import type { IWorker, IWorkerFactory } from '@/shared/queue';
import type { IScannerService } from './scanner.module';

export const SCANNER_QUEUE = 'scan-releases';
export type ScanJobData = Record<string, never>;

export const buildScannerWorker = (factory: IWorkerFactory, service: IScannerService): IWorker =>
  factory.createWorker<ScanJobData>(
    SCANNER_QUEUE,
    async () => {
      await service.scanAllRepos();
    },
    { concurrency: 1 },
  );
