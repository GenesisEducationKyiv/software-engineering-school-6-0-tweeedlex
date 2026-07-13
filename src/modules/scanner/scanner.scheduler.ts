import type { IScheduler } from '@/shared/queue';

export const buildScannerScheduler = (scheduler: IScheduler, intervalMs: number) => ({
  start: () => scheduler.scheduleRepeatable('scan-releases', {}, intervalMs),
  stop: () => scheduler.stop(),
});
