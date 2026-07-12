import { SAGA_EXCHANGES, SAGA_ROUTING_KEYS } from '@/shared/messaging';
import type { Channel } from 'amqplib';

export const SAGA_QUEUES = {
  commands: 'saga.commands.confirmation',
  replies: 'saga.replies.confirmation',
} as const;

/** Idempotent declaration of the saga command + reply exchanges and queues. */
export async function assertSagaTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(SAGA_EXCHANGES.commands, 'direct', { durable: true });
  await channel.assertExchange(SAGA_EXCHANGES.replies, 'direct', { durable: true });

  await channel.assertQueue(SAGA_QUEUES.commands, { durable: true });
  await channel.bindQueue(
    SAGA_QUEUES.commands,
    SAGA_EXCHANGES.commands,
    SAGA_ROUTING_KEYS.sendConfirmation,
  );

  await channel.assertQueue(SAGA_QUEUES.replies, { durable: true });
  await channel.bindQueue(
    SAGA_QUEUES.replies,
    SAGA_EXCHANGES.replies,
    SAGA_ROUTING_KEYS.confirmationResult,
  );
}
