export { NotificationService } from './notification.service';
export { MockEmailProvider } from './mock-email.provider';
export { ResendEmailProvider } from './resend.provider';
export type { EmailProvider } from './email.provider';
export { NOTIFICATION_QUEUE } from './notification.queue';
export type {
  NotificationJob,
  ConfirmationJob,
  ReleaseNotificationJob,
} from './notification.queue';
export { NotificationHandlers, registerNotificationHandlers } from './notification.handlers';
export { buildNotificationWorker } from './notification.worker';
