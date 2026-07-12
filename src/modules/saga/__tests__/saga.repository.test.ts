import { SagaRepository } from '../saga.repository';

function fakePrisma() {
  return {
    sagaInstance: {
      create: jest.fn().mockResolvedValue(undefined),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('SagaRepository', () => {
  it('create inserts a STARTED instance on the tx client', async () => {
    const prisma = fakePrisma();
    const tx = fakePrisma();
    const repo = new SagaRepository(prisma as never);
    await repo.create(
      { id: 's1', type: 'confirmation', subscriptionId: 'sub1', email: 'a@b.c', repoSlug: 'x/y' },
      tx as never,
    );
    expect(tx.sagaInstance.create).toHaveBeenCalledWith({
      data: {
        id: 's1',
        type: 'confirmation',
        status: 'STARTED',
        subscriptionId: 'sub1',
        email: 'a@b.c',
        repoSlug: 'x/y',
      },
    });
  });

  it('updateStatus writes status and lastError', async () => {
    const prisma = fakePrisma();
    const repo = new SagaRepository(prisma as never);
    await repo.updateStatus('s1', 'COMPENSATED', 'email failed');
    expect(prisma.sagaInstance.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'COMPENSATED', lastError: 'email failed' },
    });
  });

  it('findStaleStarted queries STARTED older than the cutoff', async () => {
    const prisma = fakePrisma();
    const repo = new SagaRepository(prisma as never);
    const cutoff = new Date('2026-06-20T00:00:00Z');
    await repo.findStaleStarted(cutoff);
    expect(prisma.sagaInstance.findMany).toHaveBeenCalledWith({
      where: { status: 'STARTED', createdAt: { lt: cutoff } },
    });
  });

  it('create uses default prisma when no tx provided', async () => {
    const prisma = fakePrisma();
    const repo = new SagaRepository(prisma as never);
    await repo.create({
      id: 's2',
      type: 'confirmation',
      subscriptionId: 'sub2',
      email: 'b@b.c',
      repoSlug: 'a/b',
    });
    expect(prisma.sagaInstance.create).toHaveBeenCalledWith({
      data: {
        id: 's2',
        type: 'confirmation',
        status: 'STARTED',
        subscriptionId: 'sub2',
        email: 'b@b.c',
        repoSlug: 'a/b',
      },
    });
  });

  it('findById returns null when record not found', async () => {
    const prisma = fakePrisma();
    const repo = new SagaRepository(prisma as never);
    const result = await repo.findById('nonexistent');
    expect(result).toBeNull();
  });
});
