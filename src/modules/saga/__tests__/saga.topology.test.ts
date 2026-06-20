import { SAGA_QUEUES, assertSagaTopology } from '../saga.topology';

function fakeChannel() {
  return {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
  };
}

describe('assertSagaTopology', () => {
  it('declares the commands + replies exchanges and binds both queues', async () => {
    const ch = fakeChannel();
    await assertSagaTopology(ch as never);
    expect(ch.assertExchange).toHaveBeenCalledWith('saga.commands', 'direct', { durable: true });
    expect(ch.assertExchange).toHaveBeenCalledWith('saga.replies', 'direct', { durable: true });
    expect(ch.assertQueue).toHaveBeenCalledWith(
      SAGA_QUEUES.commands,
      expect.objectContaining({ durable: true }),
    );
    expect(ch.assertQueue).toHaveBeenCalledWith(
      SAGA_QUEUES.replies,
      expect.objectContaining({ durable: true }),
    );
    expect(ch.bindQueue).toHaveBeenCalledWith(
      SAGA_QUEUES.commands,
      'saga.commands',
      'saga.send-confirmation',
    );
    expect(ch.bindQueue).toHaveBeenCalledWith(
      SAGA_QUEUES.replies,
      'saga.replies',
      'saga.confirmation-result',
    );
    expect(ch.assertExchange).toHaveBeenCalledTimes(2);
    expect(ch.assertQueue).toHaveBeenCalledTimes(2);
    expect(ch.bindQueue).toHaveBeenCalledTimes(2);
  });
});
