import { type ConnectionOptions, Worker } from 'bullmq';
import { logger } from '../../config/logger';
import type { GitHubRelease } from '../github/github.types';
import type { NotificationService } from './notification.service';

export const NOTIFICATION_QUEUE = 'notifications';

export interface ConfirmationJobData {
  type: 'confirmation';
  email: string;
  confirmToken: string;
  repo: string;
}

export interface ReleaseNotificationJobData {
  type: 'release-notification';
  email: string;
  unsubscribeToken: string;
  repo: string;
  release: GitHubRelease;
}

export type NotificationJobData = ConfirmationJobData | ReleaseNotificationJobData;

export class NotificationWorker {
  private readonly worker: Worker;

  constructor(connection: ConnectionOptions, notificationService: NotificationService) {
    this.worker = new Worker<NotificationJobData>(
      NOTIFICATION_QUEUE,
      async (job) => {
        const data = job.data;

        if (data.type === 'confirmation') {
          await notificationService.sendConfirmationEmail(data.email, data.confirmToken, data.repo);
        } else if (data.type === 'release-notification') {
          await notificationService.sendReleaseNotification(
            data.email,
            data.unsubscribeToken,
            data.repo,
            data.release,
          );
        }
      },
      {
        connection,
      },
    );

    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id, type: job.data.type }, 'Notification job completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err }, 'Notification job failed');
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
