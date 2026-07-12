import type { Prisma, PrismaClient } from '@prisma/client';

/** A Prisma client or an interactive-transaction client. */
export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface NewOutboxMessage {
  sagaId: string;
  exchange: string;
  routingKey: string;
  payload: unknown;
}

export interface OutboxRecord {
  id: string;
  sagaId: string;
  exchange: string;
  routingKey: string;
  payload: unknown;
  attempts: number;
}

export interface IOutboxRepository {
  /** Insert a PENDING message. Pass a tx client to enlist in a transaction. */
  enqueue(msg: NewOutboxMessage, tx?: PrismaLike): Promise<void>;
  findPending(limit: number): Promise<OutboxRecord[]>;
  markSent(id: string): Promise<void>;
  bumpAttempts(id: string): Promise<void>;
}
