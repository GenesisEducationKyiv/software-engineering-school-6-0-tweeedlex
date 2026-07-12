import type { ILogger } from '@/shared/logger';
import {
  type ConfirmationResultReply,
  SAGA_EXCHANGES,
  SAGA_ROUTING_KEYS,
  SAGA_SCHEMA_VERSION,
  type SendConfirmationCommand,
} from '@/shared/messaging';
import type { IOutboxRepository, PrismaLike } from '@/shared/outbox';
import type { ISagaRepository } from './saga.repository.interface';

export interface StartConfirmationInput {
  subscriptionId: string;
  email: string;
  repoSlug: string;
  confirmToken: string;
}

/** Deletes the subscription row; injected to avoid a saga -> subscriptions import. */
export type CompensateFn = (subscriptionId: string) => Promise<void>;

/**
 * Minimal saga surface the service needs. `tx` is typed `unknown` deliberately:
 * the service passes it through opaquely (from $transaction callback) and must
 * not depend on PrismaLike to avoid an outbox→subscriptions import chain.
 */
export interface IConfirmationSagaStarter {
  start(
    input: { subscriptionId: string; email: string; repoSlug: string; confirmToken: string },
    tx: unknown,
  ): Promise<string>;
}

const TERMINAL = new Set(['COMPLETED', 'COMPENSATED', 'FAILED']);

export class ConfirmationSaga {
  constructor(
    private readonly sagas: ISagaRepository,
    private readonly outbox: IOutboxRepository,
    private readonly compensate: CompensateFn,
    private readonly generateId: () => string,
    private readonly timeoutMs: number,
    private readonly logger: ILogger,
  ) {}

  /** Step 1, inside the caller's transaction: record the saga + enqueue the command. */
  async start(input: StartConfirmationInput, tx: PrismaLike): Promise<string> {
    const sagaId = this.generateId();
    await this.sagas.create(
      {
        id: sagaId,
        type: 'confirmation',
        subscriptionId: input.subscriptionId,
        email: input.email,
        repoSlug: input.repoSlug,
      },
      tx,
    );
    const command: SendConfirmationCommand = {
      v: SAGA_SCHEMA_VERSION,
      sagaId,
      email: input.email,
      confirmToken: input.confirmToken,
      repo: input.repoSlug,
    };
    await this.outbox.enqueue(
      {
        sagaId,
        exchange: SAGA_EXCHANGES.commands,
        routingKey: SAGA_ROUTING_KEYS.sendConfirmation,
        payload: command,
      },
      tx,
    );
    return sagaId;
  }

  async handleReply(reply: ConfirmationResultReply): Promise<void> {
    const saga = await this.sagas.findById(reply.sagaId);
    if (!saga) {
      this.logger.warn({ sagaId: reply.sagaId }, 'Reply for unknown saga; ignoring');
      return;
    }
    if (TERMINAL.has(saga.status)) {
      this.logger.info({ sagaId: reply.sagaId, status: saga.status }, 'Duplicate reply; ignoring');
      return;
    }

    if (reply.success) {
      await this.sagas.updateStatus(saga.id, 'COMPLETED', undefined);
      this.logger.info({ sagaId: saga.id }, 'Saga completed');
      return;
    }

    await this.compensateSaga(saga.id, saga.subscriptionId, reply.error ?? 'unknown error');
  }

  async sweepTimeouts(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - this.timeoutMs);
    const stale = await this.sagas.findStaleStarted(cutoff);
    for (const saga of stale) {
      this.logger.warn({ sagaId: saga.id }, 'Saga timed out; compensating');
      await this.compensateSaga(saga.id, saga.subscriptionId, 'timeout');
    }
  }

  private async compensateSaga(id: string, subscriptionId: string, reason: string): Promise<void> {
    try {
      await this.compensate(subscriptionId);
      await this.sagas.updateStatus(id, 'COMPENSATED', reason);
      this.logger.info({ sagaId: id }, 'Saga compensated');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.sagas.updateStatus(id, 'FAILED', `compensation failed: ${message}`);
      this.logger.error({ sagaId: id, err }, 'Compensation failed; saga FAILED');
    }
  }
}
