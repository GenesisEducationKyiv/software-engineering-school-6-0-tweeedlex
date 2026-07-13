export type {
  IOutboxRepository,
  NewOutboxMessage,
  OutboxRecord,
  PrismaLike,
} from './outbox.repository.interface';
export { OutboxRepository } from './outbox.repository';
export { OutboxRelay, type PublishFn, type OutboxRelayOptions } from './outbox-relay';
