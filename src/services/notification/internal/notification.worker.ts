import type { IWorker, IWorkerFactory } from '@/shared/queue';
import { NOTIFICATION_QUEUE, type NotificationJob } from './notification.queue';
import type { NotificationService } from './notification.service';

export { NOTIFICATION_QUEUE } from './notification.queue';
export type {
  NotificationJob,
  ConfirmationJob,
  ReleaseNotificationJob,
} from './notification.queue';

export const buildNotificationWorker = (
  factory: IWorkerFactory,
  service: NotificationService,
): IWorker =>
  factory.createWorker<NotificationJob>(NOTIFICATION_QUEUE, async (job) => {
    if (job.data.type === 'confirmation') {
      await service.sendConfirmationEmail(job.data.email, job.data.confirmToken, job.data.repo);
    } else {
      await service.sendReleaseNotification(
        job.data.email,
        job.data.unsubscribeToken,
        job.data.repo,
        job.data.release,
      );
    }
  });
