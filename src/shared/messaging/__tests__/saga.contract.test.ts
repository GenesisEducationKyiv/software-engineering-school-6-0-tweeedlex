import {
  SAGA_EXCHANGES,
  SAGA_ROUTING_KEYS,
  SAGA_SCHEMA_VERSION,
  type SendConfirmationCommand,
  type ConfirmationResultReply,
} from '../saga.contract';

describe('saga.contract', () => {
  it('defines the two saga exchanges', () => {
    expect(SAGA_EXCHANGES.commands).toBe('saga.commands');
    expect(SAGA_EXCHANGES.replies).toBe('saga.replies');
  });

  it('defines command and reply routing keys', () => {
    expect(SAGA_ROUTING_KEYS.sendConfirmation).toBe('saga.send-confirmation');
    expect(SAGA_ROUTING_KEYS.confirmationResult).toBe('saga.confirmation-result');
  });

  it('command and reply carry the schema version and sagaId', () => {
    const cmd: SendConfirmationCommand = {
      v: SAGA_SCHEMA_VERSION,
      sagaId: 's1',
      email: 'a@b.c',
      confirmToken: 'tok',
      repo: 'golang/go',
    };
    const reply: ConfirmationResultReply = { v: SAGA_SCHEMA_VERSION, sagaId: 's1', success: true };
    expect(cmd.v).toBe(SAGA_SCHEMA_VERSION);
    expect(reply.v).toBe(SAGA_SCHEMA_VERSION);
  });

  it('failure reply carries the error field', () => {
    const reply: ConfirmationResultReply = { v: SAGA_SCHEMA_VERSION, sagaId: 's1', success: false, error: 'smtp down' };
    expect(reply.success).toBe(false);
    expect(reply.error).toBe('smtp down');
  });
});
