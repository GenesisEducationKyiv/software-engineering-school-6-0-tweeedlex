import { OutboxRepository } from '../outbox.repository';

function fakePrisma() {
  return {
    outboxMessage: {
      create: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('OutboxRepository', () => {
  it('enqueue uses the passed tx client when provided', async () => {
    const prisma = fakePrisma();
    const tx = fakePrisma();
    const repo = new OutboxRepository(prisma as never);
    await repo.enqueue(
      { sagaId: 's1', exchange: 'saga.commands', routingKey: 'k', payload: { a: 1 } },
      tx as never,
    );
    expect(tx.outboxMessage.create).toHaveBeenCalledWith({
      data: { sagaId: 's1', exchange: 'saga.commands', routingKey: 'k', payload: { a: 1 } },
    });
    expect(prisma.outboxMessage.create).not.toHaveBeenCalled();
  });

  it('findPending returns PENDING ordered by createdAt with a limit', async () => {
    const prisma = fakePrisma();
    prisma.outboxMessage.findMany.mockResolvedValue([
      { id: 'o1', sagaId: 's1', exchange: 'e', routingKey: 'k', payload: {}, attempts: 0 },
    ]);
    const repo = new OutboxRepository(prisma as never);
    const rows = await repo.findPending(10);
    expect(prisma.outboxMessage.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('o1');
  });

  it('markSent sets status SENT and sentAt', async () => {
    const prisma = fakePrisma();
    const repo = new OutboxRepository(prisma as never);
    await repo.markSent('o1');
    expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: 'SENT', sentAt: expect.any(Date) },
    });
  });

  it('bumpAttempts increments attempts', async () => {
    const prisma = fakePrisma();
    const repo = new OutboxRepository(prisma as never);
    await repo.bumpAttempts('o1');
    expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { attempts: { increment: 1 } },
    });
  });

  it('enqueue uses default prisma when no tx provided', async () => {
    const prisma = fakePrisma();
    const repo = new OutboxRepository(prisma as never);
    await repo.enqueue({ sagaId: 's1', exchange: 'saga.commands', routingKey: 'k', payload: {} });
    expect(prisma.outboxMessage.create).toHaveBeenCalledWith({
      data: { sagaId: 's1', exchange: 'saga.commands', routingKey: 'k', payload: {} },
    });
  });
});
