import type { Channel } from 'amqplib';
import { ROUTING_KEYS } from '../messaging.contract';

export const TOPOLOGY = {
  exchange: 'notifications',
  dlx: 'notifications.dlx',
  queue: 'notifications.email',
  retryQueue: 'notifications.retry',
  parkingLot: 'notifications.parking-lot',
  /** Dead-letter routing key used inside the DLX (single key, direct exchange). */
  retryRoutingKey: 'retry',
} as const;

/**
 * Single source of truth for the retry-queue TTL. Both the publisher and the
 * consumer call assertTopology(); RabbitMQ rejects a queue redeclaration with
 * inequivalent args (PRECONDITION_FAILED), so both MUST use the same value.
 * The notification service overrides this from config; the main-service
 * publisher (no retry config) uses this default.
 */
export const RETRY_DELAY_MS = 5000;

export interface TopologyOptions {
  /** How long a message waits in the retry queue before redelivery. */
  retryDelayMs: number;
}

/**
 * Declares the full topic exchange + dead-letter retry path. Idempotent:
 * safe to call on every consumer/publisher start.
 *
 * Flow:
 *   main queue (notifications.email) --nack--> DLX --> retry queue (TTL)
 *     --expire--> dead-letters back to notifications exchange --> main queue
 *   parking-lot is a separate durable queue the consumer publishes to directly
 *   once attempts are exhausted or a message is unparseable.
 */
export async function assertTopology(channel: Channel, opts: TopologyOptions): Promise<void> {
  await channel.assertExchange(TOPOLOGY.exchange, 'topic', { durable: true });
  await channel.assertExchange(TOPOLOGY.dlx, 'direct', { durable: true });

  await channel.assertQueue(TOPOLOGY.queue, {
    durable: true,
    deadLetterExchange: TOPOLOGY.dlx,
    deadLetterRoutingKey: TOPOLOGY.retryRoutingKey,
  });
  await channel.bindQueue(TOPOLOGY.queue, TOPOLOGY.exchange, ROUTING_KEYS.SUBSCRIPTION_CREATED);
  await channel.bindQueue(TOPOLOGY.queue, TOPOLOGY.exchange, ROUTING_KEYS.RELEASE_DETECTED);

  // Retry queue: holds a message for retryDelayMs, then dead-letters it back to
  // the main exchange (default exchange routing by queue name would not re-bind,
  // so we route back through the topic exchange via the original routing key,
  // which amqp preserves in the message on dead-letter).
  await channel.assertQueue(TOPOLOGY.retryQueue, {
    durable: true,
    messageTtl: opts.retryDelayMs,
    deadLetterExchange: TOPOLOGY.exchange,
  });
  await channel.bindQueue(TOPOLOGY.retryQueue, TOPOLOGY.dlx, TOPOLOGY.retryRoutingKey);

  await channel.assertQueue(TOPOLOGY.parkingLot, { durable: true });
}
