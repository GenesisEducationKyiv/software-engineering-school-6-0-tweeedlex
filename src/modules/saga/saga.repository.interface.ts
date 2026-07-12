import type { PrismaLike } from '@/shared/outbox';

export interface NewSagaInstance {
  id: string;
  type: string;
  subscriptionId: string;
  email: string;
  repoSlug: string;
}

export interface SagaRecord {
  id: string;
  status: string;
  subscriptionId: string;
  email: string;
  repoSlug: string;
}

export interface ISagaRepository {
  /** Insert a STARTED instance. Pass a tx client to enlist in a transaction. */
  create(data: NewSagaInstance, tx?: PrismaLike): Promise<void>;
  findById(id: string): Promise<SagaRecord | null>;
  updateStatus(id: string, status: string, lastError?: string): Promise<void>;
  /** STARTED instances older than `before`. */
  findStaleStarted(before: Date): Promise<SagaRecord[]>;
}
