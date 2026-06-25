import type { ILogger } from '../../../shared/logger';
import type { IWorker, IWorkerFactory, Job } from '../../../shared/queue';
import type { NotificationJob } from '../notification.queue';
import type { NotificationService } from '../notification.service';
import { NOTIFICATION_QUEUE, buildNotificationWorker } from '../notification.worker';

type JobHandler = (job: Job<NotificationJob>) => Promise<void>;

let capturedHandler: JobHandler;
const mockWorker: IWorker = { close: jest.fn().mockResolvedValue(undefined) };
const mockFactory: IWorkerFactory = {
  createWorker: jest.fn().mockImplementation((_queueName: string, handler: JobHandler) => {
    capturedHandler = handler;
    return mockWorker;
  }),
};
const mockLogger: jest.Mocked<ILogger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as jest.Mocked<ILogger>;

const mockNotificationService: jest.Mocked<NotificationService> = {
  sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendReleaseNotification: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<NotificationService>;

describe('buildNotificationWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call createWorker with the notification queue name', () => {
    buildNotificationWorker(mockFactory, mockNotificationService, mockLogger);
    expect(mockFactory.createWorker).toHaveBeenCalledWith(NOTIFICATION_QUEUE, expect.any(Function));
  });

  it('should route confirmation jobs to sendConfirmationEmail', async () => {
    buildNotificationWorker(mockFactory, mockNotificationService, mockLogger);
    await capturedHandler({
      id: '1',
      name: 'send-confirmation',
      data: {
        type: 'confirmation',
        email: 'test@example.com',
        confirmToken: 'token123',
        repo: 'golang/go',
      },
      attemptsMade: 0,
    });
    expect(mockNotificationService.sendConfirmationEmail).toHaveBeenCalledWith(
      'test@example.com',
      'token123',
      'golang/go',
    );
  });

  it('should route release-notification jobs to sendReleaseNotification', async () => {
    buildNotificationWorker(mockFactory, mockNotificationService, mockLogger);
    const release = {
      tagName: 'v1.22.0',
      name: 'Go 1.22',
      htmlUrl: 'https://github.com/golang/go/releases/tag/v1.22.0',
      publishedAt: '2024-02-06T00:00:00Z',
    };
    await capturedHandler({
      id: '2',
      name: 'send-release-notification',
      data: {
        type: 'release-notification',
        email: 'test@example.com',
        unsubscribeToken: 'unsub123',
        repo: 'golang/go',
        release,
      },
      attemptsMade: 0,
    });
    expect(mockNotificationService.sendReleaseNotification).toHaveBeenCalledWith(
      'test@example.com',
      'unsub123',
      'golang/go',
      release,
    );
  });

  it('should return IWorker with close()', async () => {
    const worker = buildNotificationWorker(mockFactory, mockNotificationService, mockLogger);
    await worker.close();
    expect(mockWorker.close).toHaveBeenCalled();
  });
});
