import type { ConnectionOptions } from 'bullmq';
import type { ScannerService } from '../scanner.service';
import { SCANNER_QUEUE, ScannerWorker } from '../scanner.worker';

type JobProcessor = (job: unknown) => Promise<void>;
type EventHandler = (...args: unknown[]) => void;

let capturedProcessor: JobProcessor;
const capturedEventHandlers: Record<string, EventHandler> = {};

const mockWorkerInstance = {
  on: jest.fn((event: string, handler: EventHandler) => {
    capturedEventHandlers[event] = handler;
  }),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_queue: string, processor: JobProcessor, _opts: unknown) => {
    capturedProcessor = processor;
    return mockWorkerInstance;
  }),
}));

const mockScannerService: jest.Mocked<ScannerService> = {
  scanAllRepos: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<ScannerService>;

const mockConnection = {} as ConnectionOptions;

describe('ScannerWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create Worker with the correct queue name and concurrency 1', () => {
    const { Worker } = require('bullmq');
    new ScannerWorker(mockConnection, mockScannerService);
    expect(Worker).toHaveBeenCalledWith(
      SCANNER_QUEUE,
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 }),
    );
  });

  it('should call scanAllRepos when a job is processed', async () => {
    new ScannerWorker(mockConnection, mockScannerService);

    await capturedProcessor({});

    expect(mockScannerService.scanAllRepos).toHaveBeenCalledTimes(1);
  });

  it('should call worker.close() on close()', async () => {
    const worker = new ScannerWorker(mockConnection, mockScannerService);
    await worker.close();
    expect(mockWorkerInstance.close).toHaveBeenCalled();
  });

  it('should handle completed event without throwing', () => {
    new ScannerWorker(mockConnection, mockScannerService);
    expect(() => capturedEventHandlers['completed']?.({ id: 'job-1' })).not.toThrow();
  });

  it('should handle failed event without throwing', () => {
    new ScannerWorker(mockConnection, mockScannerService);
    expect(() =>
      capturedEventHandlers['failed']?.({ id: 'job-1' }, new Error('scan failed')),
    ).not.toThrow();
  });
});
