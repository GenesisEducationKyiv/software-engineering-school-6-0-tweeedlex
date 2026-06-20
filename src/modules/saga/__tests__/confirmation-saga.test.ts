import { SAGA_EXCHANGES, SAGA_ROUTING_KEYS, SAGA_SCHEMA_VERSION } from '@/shared/messaging';
import type { IOutboxRepository } from '@/shared/outbox';
import { ConfirmationSaga } from '../confirmation-saga';
import type { ISagaRepository, SagaRecord } from '../saga.repository.interface';

let logger: {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
  child: () => typeof logger;
};

beforeEach(() => {
  logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  };
});

function sagaRepo(): jest.Mocked<ISagaRepository> {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(null),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    findStaleStarted: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<ISagaRepository>;
}
function outboxRepo(): jest.Mocked<IOutboxRepository> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    findPending: jest.fn(),
    markSent: jest.fn(),
    bumpAttempts: jest.fn(),
  } as unknown as jest.Mocked<IOutboxRepository>;
}
function record(over: Partial<SagaRecord> = {}): SagaRecord {
  return {
    id: 's1',
    status: 'STARTED',
    subscriptionId: 'sub1',
    email: 'a@b.c',
    repoSlug: 'x/y',
    ...over,
  };
}

describe('ConfirmationSaga', () => {
  it('start creates the instance and enqueues the command on the same tx', async () => {
    const saga = sagaRepo();
    const outbox = outboxRepo();
    const compensate = jest.fn();
    const orch = new ConfirmationSaga(saga, outbox, compensate, () => 's1', 60000, logger);
    const tx = {} as never; // jest mock cast

    await orch.start(
      { subscriptionId: 'sub1', email: 'a@b.c', repoSlug: 'x/y', confirmToken: 'tok' },
      tx,
    );

    expect(saga.create).toHaveBeenCalledWith(
      { id: 's1', type: 'confirmation', subscriptionId: 'sub1', email: 'a@b.c', repoSlug: 'x/y' },
      tx,
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      {
        sagaId: 's1',
        exchange: SAGA_EXCHANGES.commands,
        routingKey: SAGA_ROUTING_KEYS.sendConfirmation,
        payload: {
          v: SAGA_SCHEMA_VERSION,
          sagaId: 's1',
          email: 'a@b.c',
          confirmToken: 'tok',
          repo: 'x/y',
        },
      },
      tx,
    );
  });

  it('handleReply success marks the saga COMPLETED', async () => {
    const saga = sagaRepo();
    saga.findById.mockResolvedValue(record());
    const orch = new ConfirmationSaga(saga, outboxRepo(), jest.fn(), () => 's1', 60000, logger);
    await orch.handleReply({ v: 1, sagaId: 's1', success: true });
    expect(saga.updateStatus).toHaveBeenCalledWith('s1', 'COMPLETED', undefined);
  });

  it('handleReply failure compensates and marks COMPENSATED', async () => {
    const saga = sagaRepo();
    saga.findById.mockResolvedValue(record());
    const compensate = jest.fn().mockResolvedValue(undefined);
    const orch = new ConfirmationSaga(saga, outboxRepo(), compensate, () => 's1', 60000, logger);
    await orch.handleReply({ v: 1, sagaId: 's1', success: false, error: 'smtp down' });
    expect(compensate).toHaveBeenCalledWith('sub1');
    expect(saga.updateStatus).toHaveBeenCalledWith('s1', 'COMPENSATED', 'smtp down');
  });

  it('handleReply is a no-op when the saga is already terminal (duplicate reply)', async () => {
    const saga = sagaRepo();
    saga.findById.mockResolvedValue(record({ status: 'COMPLETED' }));
    const compensate = jest.fn();
    const orch = new ConfirmationSaga(saga, outboxRepo(), compensate, () => 's1', 60000, logger);
    await orch.handleReply({ v: 1, sagaId: 's1', success: false });
    expect(compensate).not.toHaveBeenCalled();
    expect(saga.updateStatus).not.toHaveBeenCalled();
  });

  it('handleReply marks FAILED when compensation throws', async () => {
    const saga = sagaRepo();
    saga.findById.mockResolvedValue(record());
    const compensate = jest.fn().mockRejectedValue(new Error('db gone'));
    const orch = new ConfirmationSaga(saga, outboxRepo(), compensate, () => 's1', 60000, logger);
    await orch.handleReply({ v: 1, sagaId: 's1', success: false, error: 'smtp down' });
    expect(saga.updateStatus).toHaveBeenCalledWith(
      's1',
      'FAILED',
      expect.stringContaining('db gone'),
    );
  });

  it('sweepTimeouts compensates stale STARTED sagas', async () => {
    const saga = sagaRepo();
    saga.findStaleStarted.mockResolvedValue([record()]);
    const compensate = jest.fn().mockResolvedValue(undefined);
    const orch = new ConfirmationSaga(saga, outboxRepo(), compensate, () => 's1', 60000, logger);
    const now = new Date('2026-06-20T12:00:00Z');
    await orch.sweepTimeouts(now);
    const expectedCutoff = new Date(now.getTime() - 60000);
    expect(saga.findStaleStarted).toHaveBeenCalledWith(expectedCutoff);
    expect(compensate).toHaveBeenCalledWith('sub1');
    expect(saga.updateStatus).toHaveBeenCalledWith('s1', 'COMPENSATED', 'timeout');
  });

  it('handleReply failure without error field uses fallback reason', async () => {
    const saga = sagaRepo();
    saga.findById.mockResolvedValue(record());
    const compensate = jest.fn().mockResolvedValue(undefined);
    const orch = new ConfirmationSaga(saga, outboxRepo(), compensate, () => 's1', 60000, logger);
    await orch.handleReply({ v: 1, sagaId: 's1', success: false });
    expect(compensate).toHaveBeenCalledWith('sub1');
    expect(saga.updateStatus).toHaveBeenCalledWith('s1', 'COMPENSATED', 'unknown error');
  });
});
