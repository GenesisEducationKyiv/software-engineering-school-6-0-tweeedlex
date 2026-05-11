import type { IScheduler } from '@/shared/queue';
import { SCANNER_QUEUE } from './scanner.worker';

export const buildScannerScheduler = (scheduler: IScheduler, intervalMs: number) => ({
  start: () => scheduler.scheduleRepeatable('scan-releases', {}, intervalMs),
  stop: () => scheduler.stop(),
});
