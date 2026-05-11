import type { ConnectionOptions } from 'bullmq';
import { ScannerScheduler } from '../scanner.scheduler';
import { SCANNER_QUEUE } from '../scanner.worker';

const mockQueueInstance = {
  getRepeatableJobs: jest.fn(),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
  add: jest.fn().mockResolvedValue({}),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => mockQueueInstance),
}));

const mockConnection = {} as ConnectionOptions;
const INTERVAL_MS = 60_000;

describe('ScannerScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create Queue with the correct queue name', () => {
    const { Queue } = require('bullmq');
    new ScannerScheduler(mockConnection, INTERVAL_MS);
    expect(Queue).toHaveBeenCalledWith(SCANNER_QUEUE, expect.any(Object));
  });

  describe('start()', () => {
    it('should add a repeatable job when no existing jobs', async () => {
      mockQueueInstance.getRepeatableJobs.mockResolvedValue([]);

      const scheduler = new ScannerScheduler(mockConnection, INTERVAL_MS);
      await scheduler.start();

      expect(mockQueueInstance.removeRepeatableByKey).not.toHaveBeenCalled();
      expect(mockQueueInstance.add).toHaveBeenCalledTimes(1);
    });

    it('should remove existing repeatable jobs before adding new one', async () => {
      mockQueueInstance.getRepeatableJobs.mockResolvedValue([
        { key: 'key-1' },
        { key: 'key-2' },
      ]);

      const scheduler = new ScannerScheduler(mockConnection, INTERVAL_MS);
      await scheduler.start();

      expect(mockQueueInstance.removeRepeatableByKey).toHaveBeenCalledWith('key-1');
      expect(mockQueueInstance.removeRepeatableByKey).toHaveBeenCalledWith('key-2');
      expect(mockQueueInstance.add).toHaveBeenCalledTimes(1);
    });

    it('should add job with correct repeat interval and cleanup options', async () => {
      mockQueueInstance.getRepeatableJobs.mockResolvedValue([]);

      const scheduler = new ScannerScheduler(mockConnection, INTERVAL_MS);
      await scheduler.start();

      expect(mockQueueInstance.add).toHaveBeenCalledWith(
        'scan-releases',
        {},
        expect.objectContaining({
          repeat: { every: INTERVAL_MS },
          removeOnComplete: 10,
          removeOnFail: 50,
        }),
      );
    });
  });

  describe('stop()', () => {
    it('should remove all repeatable jobs and close the queue', async () => {
      mockQueueInstance.getRepeatableJobs.mockResolvedValue([{ key: 'key-1' }]);

      const scheduler = new ScannerScheduler(mockConnection, INTERVAL_MS);
      await scheduler.stop();

      expect(mockQueueInstance.removeRepeatableByKey).toHaveBeenCalledWith('key-1');
      expect(mockQueueInstance.close).toHaveBeenCalled();
    });

    it('should close the queue even when there are no repeatable jobs', async () => {
      mockQueueInstance.getRepeatableJobs.mockResolvedValue([]);

      const scheduler = new ScannerScheduler(mockConnection, INTERVAL_MS);
      await scheduler.stop();

      expect(mockQueueInstance.removeRepeatableByKey).not.toHaveBeenCalled();
      expect(mockQueueInstance.close).toHaveBeenCalled();
    });
  });
});
