import type { ILogger } from '@/shared/logger';
import type { IOutboxRepository } from './outbox.repository.interface';

export type PublishFn = (exchange: string, routingKey: string, payload: unknown) => Promise<void>;

export interface OutboxRelayOptions {
  batchSize: number;
  maxAttempts: number;
}

/**
 * Polls the outbox for PENDING rows and publishes them. At-least-once: a row is
 * marked SENT only after a successful publish, so a crash between publish and
 * markSent yields a duplicate publish (consumers must tolerate duplicates).
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: IOutboxRepository,
    private readonly publish: PublishFn,
    private readonly opts: OutboxRelayOptions,
    private readonly logger: ILogger,
  ) {}

  async drainOnce(): Promise<void> {
    const pending = await this.repo.findPending(this.opts.batchSize);
    for (const row of pending) {
      try {
        await this.publish(row.exchange, row.routingKey, row.payload);
        await this.repo.markSent(row.id);
      } catch (err) {
        try {
          await this.repo.bumpAttempts(row.id);
        } catch (bumpErr) {
          this.logger.error({ err: bumpErr, id: row.id }, 'Failed to bump outbox attempts');
        }
        if (row.attempts + 1 >= this.opts.maxAttempts) {
          this.logger.error(
            { id: row.id, attempts: row.attempts + 1 },
            'Outbox row exceeded max publish attempts; staying PENDING for manual review',
          );
        } else {
          this.logger.warn({ err, id: row.id }, 'Outbox publish failed; will retry next poll');
        }
      }
    }
  }

  start(intervalMs: number): void {
    if (this.timer) {
      this.logger.warn('OutboxRelay.start() called while already running; ignoring');
      return;
    }
    this.timer = setInterval(() => {
      void this.drainOnce();
    }, intervalMs);
    this.logger.info({ intervalMs }, 'Outbox relay started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
