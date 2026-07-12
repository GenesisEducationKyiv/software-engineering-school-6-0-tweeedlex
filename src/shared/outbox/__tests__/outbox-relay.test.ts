import type { ILogger } from '@/shared/logger';
import { OutboxRelay } from '../outbox-relay';
import type { IOutboxRepository, OutboxRecord } from '../outbox.repository.interface';

function rec(id: string): OutboxRecord {
  return {
    id,
    sagaId: 's1',
    exchange: 'saga.commands',
    routingKey: 'k',
    payload: { a: 1 },
    attempts: 0,
  };
}

function repoWith(pending: OutboxRecord[]): jest.Mocked<IOutboxRepository> {
  return {
    enqueue: jest.fn(),
    findPending: jest.fn().mockResolvedValue(pending),
    markSent: jest.fn().mockResolvedValue(undefined),
    bumpAttempts: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IOutboxRepository>;
}

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: () => logger,
} as unknown as jest.Mocked<ILogger>;

describe('OutboxRelay.drainOnce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes each pending row then marks it SENT', async () => {
    const repo = repoWith([rec('o1')]);
    const publish = jest.fn().mockResolvedValue(undefined);
    const relay = new OutboxRelay(repo, publish, { batchSize: 10, maxAttempts: 5 }, logger);
    await relay.drainOnce();
    expect(publish).toHaveBeenCalledWith('saga.commands', 'k', { a: 1 });
    expect(repo.markSent).toHaveBeenCalledWith('o1');
  });

  it('leaves the row PENDING and bumps attempts when publish throws', async () => {
    const repo = repoWith([rec('o1')]);
    const publish = jest.fn().mockRejectedValue(new Error('rabbit down'));
    const relay = new OutboxRelay(repo, publish, { batchSize: 10, maxAttempts: 5 }, logger);
    await relay.drainOnce();
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.bumpAttempts).toHaveBeenCalledWith('o1');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1' }),
      'Outbox publish failed; will retry next poll',
    );
  });

  it('does nothing when there are no pending rows', async () => {
    const repo = repoWith([]);
    const publish = jest.fn();
    const relay = new OutboxRelay(repo, publish, { batchSize: 10, maxAttempts: 5 }, logger);
    await relay.drainOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(repo.bumpAttempts).not.toHaveBeenCalled();
    expect(repo.markSent).not.toHaveBeenCalled();
  });
});
