import type { ILogger } from '@/shared/logger';
import type { ConsumeMessage } from 'amqplib';
import type { IMessageConsumer, MessageHandler } from '../message-broker.interface';
import type { RabbitMqConnection } from './rabbitmq-connection';
import { TOPOLOGY, type TopologyOptions, assertTopology } from './topology';

export interface ConsumerOptions extends TopologyOptions {
  /** Max delivery attempts before a message is parked. */
  maxAttempts: number;
  /** Unacked-message window. Defaults to 10. */
  prefetch?: number;
}

/** Reads the retry count from the x-death header (0 on first delivery). */
function readAttempt(msg: ConsumeMessage): number {
  const xDeath = msg.properties.headers?.['x-death'] as Array<{ count?: number }> | undefined;
  if (!xDeath || xDeath.length === 0) return 0;
  return Number(xDeath[0]?.count ?? 0);
}

export class RabbitMqConsumer implements IMessageConsumer {
  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly opts: ConsumerOptions,
    private readonly logger: ILogger,
  ) {}

  async start<T>(handler: MessageHandler<T>): Promise<void> {
    const channel = await this.connection.getChannel();
    await assertTopology(channel, { retryDelayMs: this.opts.retryDelayMs });
    await channel.prefetch(this.opts.prefetch ?? 10);

    await channel.consume(TOPOLOGY.queue, async (msg) => {
      if (!msg) return;
      const attempt = readAttempt(msg);

      let payload: T;
      try {
        payload = JSON.parse(msg.content.toString()) as T;
      } catch (err) {
        this.logger.error({ err }, 'Unparseable message, sending to parking-lot');
        this.park(channel, msg);
        channel.ack(msg);
        return;
      }

      let result: 'ack' | 'retry' | 'reject';
      try {
        result = await handler({ routingKey: msg.fields.routingKey, payload, attempt });
      } catch (err) {
        this.logger.error({ err, routingKey: msg.fields.routingKey }, 'Handler threw, will retry');
        result = 'retry';
      }

      if (result === 'ack') {
        channel.ack(msg);
        return;
      }

      if (result === 'reject') {
        this.park(channel, msg);
        channel.ack(msg);
        return;
      }

      // retry
      if (attempt >= this.opts.maxAttempts) {
        this.logger.warn(
          { attempt, routingKey: msg.fields.routingKey },
          'Attempts exhausted, parking',
        );
        this.park(channel, msg);
        channel.ack(msg);
        return;
      }
      // requeue=false -> message dead-letters to the DLX -> retry queue (TTL delay).
      channel.nack(msg, false, false);
    });

    this.logger.info({ queue: TOPOLOGY.queue }, 'Consumer started');
  }

  private park(
    channel: Awaited<ReturnType<RabbitMqConnection['getChannel']>>,
    msg: ConsumeMessage,
  ): void {
    channel.sendToQueue(TOPOLOGY.parkingLot, msg.content, { persistent: true });
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
