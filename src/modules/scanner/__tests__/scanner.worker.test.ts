import type { IWorker, IWorkerFactory, Job } from '../../../shared/queue';
import type { ScannerService } from '../scanner.service';
import { SCANNER_QUEUE, buildScannerWorker } from '../scanner.worker';

type JobHandler = (job: Job<Record<string, never>>) => Promise<void>;
let capturedHandler: JobHandler;
let capturedOptions: unknown;
const mockWorker: IWorker = { close: jest.fn().mockResolvedValue(undefined) };
const mockFactory: IWorkerFactory = {
  createWorker: jest.fn().mockImplementation((_q: string, h: JobHandler, o: unknown) => {
    capturedHandler = h;
    capturedOptions = o;
    return mockWorker;
  }),
};
const mockScannerService: jest.Mocked<ScannerService> = {
  scanAllRepos: jest.fn().mockResolvedValue({ scanned: 0, newReleases: 0 }),
} as unknown as jest.Mocked<ScannerService>;

describe('buildScannerWorker', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('should call createWorker with correct queue name and concurrency 1', () => {
    buildScannerWorker(mockFactory, mockScannerService);
    expect(mockFactory.createWorker).toHaveBeenCalledWith(SCANNER_QUEUE, expect.any(Function), { concurrency: 1 });
  });

  it('should call scanAllRepos when job is processed', async () => {
    buildScannerWorker(mockFactory, mockScannerService);
    await capturedHandler({ id: '1', name: 'scan', data: {}, attemptsMade: 0 });
    expect(mockScannerService.scanAllRepos).toHaveBeenCalledTimes(1);
  });

  it('should return IWorker with close()', async () => {
    const worker = buildScannerWorker(mockFactory, mockScannerService);
    await worker.close();
    expect(mockWorker.close).toHaveBeenCalled();
  });
});
