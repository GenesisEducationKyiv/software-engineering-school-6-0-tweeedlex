import { InProcessEventBus } from '../in-process-event-bus';
import type { ILogger } from '../../logger';

const mockLogger: jest.Mocked<ILogger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as jest.Mocked<ILogger>;

describe('InProcessEventBus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls all handlers even when one throws', async () => {
    const bus = new InProcessEventBus(mockLogger);
    const handler1 = jest.fn().mockRejectedValue(new Error('fail'));
    const handler2 = jest.fn().mockResolvedValue(undefined);

    bus.subscribe('test.event', handler1);
    bus.subscribe('test.event', handler2);

    await expect(bus.publish({ type: 'test.event' })).rejects.toThrow();
    expect(handler2).toHaveBeenCalled();
  });

  it('throws AggregateError when handlers fail', async () => {
    const bus = new InProcessEventBus(mockLogger);
    const err1 = new Error('fail-1');
    const err2 = new Error('fail-2');
    bus.subscribe('test.event', jest.fn().mockRejectedValue(err1));
    bus.subscribe('test.event', jest.fn().mockRejectedValue(err2));

    const thrown = await bus.publish({ type: 'test.event' }).catch((e) => e);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([err1, err2]);
  });

  it('resolves when all handlers succeed', async () => {
    const bus = new InProcessEventBus(mockLogger);
    bus.subscribe('test.event', jest.fn().mockResolvedValue(undefined));
    await expect(bus.publish({ type: 'test.event' })).resolves.toBeUndefined();
  });

  it('resolves when no handlers registered', async () => {
    const bus = new InProcessEventBus(mockLogger);
    await expect(bus.publish({ type: 'test.event' })).resolves.toBeUndefined();
  });
});
