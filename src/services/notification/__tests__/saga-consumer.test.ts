import { buildSagaCommandHandler } from '../saga-consumer';
import type { NotificationService } from '../internal/notification.service';
import { SAGA_SCHEMA_VERSION, type SendConfirmationCommand } from '@/shared/messaging';

const service = {
  sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<NotificationService>;

const cmd: SendConfirmationCommand = {
  v: SAGA_SCHEMA_VERSION, sagaId: 's1', email: 'a@b.c', confirmToken: 'tok', repo: 'x/y',
};

describe('buildSagaCommandHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the confirmation email and returns a success reply', async () => {
    const handler = buildSagaCommandHandler(service);
    const reply = await handler(cmd);
    expect(service.sendConfirmationEmail).toHaveBeenCalledWith('a@b.c', 'tok', 'x/y');
    expect(reply).toEqual({ v: SAGA_SCHEMA_VERSION, sagaId: 's1', success: true });
  });

  it('returns a failure reply with the error message when the email throws', async () => {
    service.sendConfirmationEmail.mockRejectedValueOnce(new Error('smtp down'));
    const handler = buildSagaCommandHandler(service);
    const reply = await handler(cmd);
    expect(reply).toEqual({ v: SAGA_SCHEMA_VERSION, sagaId: 's1', success: false, error: 'smtp down' });
  });
});
