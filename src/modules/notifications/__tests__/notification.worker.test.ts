import type IORedis from 'ioredis';
import type { GitHubRelease } from '../../github/github.types';
import type { NotificationService } from '../notification.service';
import { NOTIFICATION_QUEUE, NotificationWorker } from '../notification.worker';

type JobProcessor = (job: { data: unknown }) => Promise<void>;
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
  Worker: jest.fn().mockImplementation((_queue: string, processor: JobProcessor) => {
    capturedProcessor = processor;
    return mockWorkerInstance;
  }),
}));

const mockNotificationService: jest.Mocked<NotificationService> = {
  sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendReleaseNotification: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<NotificationService>;

const mockRelease: GitHubRelease = {
  id: 1,
  tag_name: 'v1.22.0',
  name: 'Go 1.22',
  body: null,
  html_url: 'https://github.com/golang/go/releases/tag/v1.22.0',
  published_at: '2024-02-06T00:00:00Z',
  draft: false,
  prerelease: false,
};

const mockConnection = {} as IORedis;

describe('NotificationWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create Worker with the correct queue name', () => {
    const { Worker } = require('bullmq');
    new NotificationWorker(mockConnection, mockNotificationService);
    expect(Worker).toHaveBeenCalledWith(NOTIFICATION_QUEUE, expect.any(Function), expect.any(Object));
  });

  it('should route confirmation job to sendConfirmationEmail', async () => {
    new NotificationWorker(mockConnection, mockNotificationService);

    await capturedProcessor({
      data: {
        type: 'confirmation',
        email: 'test@example.com',
        confirmToken: 'token123',
        repo: 'golang/go',
      },
    });

    expect(mockNotificationService.sendConfirmationEmail).toHaveBeenCalledWith(
      'test@example.com',
      'token123',
      'golang/go',
    );
    expect(mockNotificationService.sendReleaseNotification).not.toHaveBeenCalled();
  });

  it('should route release-notification job to sendReleaseNotification', async () => {
    new NotificationWorker(mockConnection, mockNotificationService);

    await capturedProcessor({
      data: {
        type: 'release-notification',
        email: 'test@example.com',
        unsubscribeToken: 'unsub456',
        repo: 'golang/go',
        release: mockRelease,
      },
    });

    expect(mockNotificationService.sendReleaseNotification).toHaveBeenCalledWith(
      'test@example.com',
      'unsub456',
      'golang/go',
      mockRelease,
    );
    expect(mockNotificationService.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('should not call any service method for unknown job type', async () => {
    new NotificationWorker(mockConnection, mockNotificationService);

    await capturedProcessor({ data: { type: 'unknown-type' } });

    expect(mockNotificationService.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(mockNotificationService.sendReleaseNotification).not.toHaveBeenCalled();
  });

  it('should call worker.close() on close()', async () => {
    const worker = new NotificationWorker(mockConnection, mockNotificationService);
    await worker.close();
    expect(mockWorkerInstance.close).toHaveBeenCalled();
  });

  it('should handle completed event without throwing', () => {
    new NotificationWorker(mockConnection, mockNotificationService);
    expect(() =>
      capturedEventHandlers['completed']?.({ id: 'job-1', data: { type: 'confirmation' } }),
    ).not.toThrow();
  });

  it('should handle failed event without throwing', () => {
    new NotificationWorker(mockConnection, mockNotificationService);
    expect(() =>
      capturedEventHandlers['failed']?.({ id: 'job-1' }, new Error('send failed')),
    ).not.toThrow();
  });
});
