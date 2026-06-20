import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  IOutboxRepository,
  NewOutboxMessage,
  OutboxRecord,
  PrismaLike,
} from './outbox.repository.interface';

export class OutboxRepository implements IOutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueue(msg: NewOutboxMessage, tx?: PrismaLike): Promise<void> {
    const client = tx ?? this.prisma;
    await client.outboxMessage.create({
      data: {
        sagaId: msg.sagaId,
        exchange: msg.exchange,
        routingKey: msg.routingKey,
        // Prisma Json column accepts a plain object.
        payload: msg.payload as Prisma.InputJsonValue,
      },
    });
  }

  async findPending(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      sagaId: r.sagaId,
      exchange: r.exchange,
      routingKey: r.routingKey,
      payload: r.payload,
      attempts: r.attempts,
    }));
  }

  async markSent(id: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  async bumpAttempts(id: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }
}
