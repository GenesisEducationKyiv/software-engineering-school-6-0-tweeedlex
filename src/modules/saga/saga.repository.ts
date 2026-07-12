import type { PrismaLike } from '@/shared/outbox';
import type { PrismaClient } from '@prisma/client';
import type { ISagaRepository, NewSagaInstance, SagaRecord } from './saga.repository.interface';

export class SagaRepository implements ISagaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: NewSagaInstance, tx?: PrismaLike): Promise<void> {
    const client = tx ?? this.prisma;
    await client.sagaInstance.create({
      data: {
        id: data.id,
        type: data.type,
        status: 'STARTED',
        subscriptionId: data.subscriptionId,
        email: data.email,
        repoSlug: data.repoSlug,
      },
    });
  }

  async findById(id: string): Promise<SagaRecord | null> {
    const row = await this.prisma.sagaInstance.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      subscriptionId: row.subscriptionId,
      email: row.email,
      repoSlug: row.repoSlug,
    };
  }

  async updateStatus(id: string, status: string, lastError?: string): Promise<void> {
    await this.prisma.sagaInstance.update({
      where: { id },
      data: { status, lastError },
    });
  }

  async findStaleStarted(before: Date): Promise<SagaRecord[]> {
    const rows = await this.prisma.sagaInstance.findMany({
      where: { status: 'STARTED', createdAt: { lt: before } },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      subscriptionId: row.subscriptionId,
      email: row.email,
      repoSlug: row.repoSlug,
    }));
  }
}
