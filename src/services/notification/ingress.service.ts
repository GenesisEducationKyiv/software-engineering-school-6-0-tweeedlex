import type { ReleaseEventPayload } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import type { IQueueProducer, JobOptions } from '@/shared/queue';
import type { NotificationJob } from './internal/notification.queue';

const RETRY: JobOptions = { attempts: 3, backoff: { type: 'exponential', delay: 2000 } };

export interface IngressAck {
  status: 'accepted';
  jobId: string;
}

export class IngressService {
  constructor(
    private readonly producer: IQueueProducer<NotificationJob>,
    private readonly logger: ILogger,
  ) {}

  async enqueueConfirmation(p: {
    email: string;
    confirmToken: string;
    repo: string;
  }): Promise<IngressAck> {
    await this.producer.enqueue('send-confirmation', { type: 'confirmation', ...p }, RETRY);
    this.logger.info({ email: p.email }, 'Confirmation enqueued');
    return { status: 'accepted', jobId: `${p.email}:confirmation` };
  }

  async enqueueRelease(p: {
    email: string;
    unsubscribeToken: string;
    repo: string;
    release: ReleaseEventPayload;
  }): Promise<IngressAck> {
    await this.producer.enqueue(
      'send-release-notification',
      { type: 'release-notification', ...p },
      RETRY,
    );
    this.logger.info({ email: p.email, repo: p.repo }, 'Release notification enqueued');
    return { status: 'accepted', jobId: `${p.email}:release` };
  }
}
