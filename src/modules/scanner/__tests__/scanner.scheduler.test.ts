import type { IScheduler } from '../../../shared/queue';
import { buildScannerScheduler } from '../scanner.scheduler';

const mockScheduler: jest.Mocked<IScheduler> = {
  scheduleRepeatable: jest.fn().mockResolvedValue(undefined),
  removeAllRepeatable: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
};

const INTERVAL_MS = 60_000;

describe('buildScannerScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call scheduleRepeatable with correct args on start()', async () => {
    const scheduler = buildScannerScheduler(mockScheduler, INTERVAL_MS);
    await scheduler.start();
    expect(mockScheduler.scheduleRepeatable).toHaveBeenCalledWith('scan-releases', {}, INTERVAL_MS);
  });

  it('should call scheduler.stop() on stop()', async () => {
    const scheduler = buildScannerScheduler(mockScheduler, INTERVAL_MS);
    await scheduler.stop();
    expect(mockScheduler.stop).toHaveBeenCalled();
  });
});
