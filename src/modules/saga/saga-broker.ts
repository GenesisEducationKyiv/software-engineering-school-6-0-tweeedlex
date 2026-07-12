import type { ILogger } from '@/shared/logger';
import type { ConfirmationResultReply } from '@/shared/messaging';
import { type RabbitMqConnection, SAGA_EXCHANGES } from '@/shared/messaging';
import { SAGA_QUEUES, assertSagaTopology } from './saga.topology';

export class SagaBroker {
  private asserted = false;

  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly logger: ILogger,
  ) {}

  private async ready() {
    const channel = await this.connection.getChannel();
    if (!this.asserted) {
      await assertSagaTopology(channel);
      this.asserted = true;
    }
    return channel;
  }

  /** Used by the outbox relay's PublishFn. */
  async publishCommand(routingKey: string, payload: unknown): Promise<void> {
    const channel = await this.ready();
    const ok = channel.publish(
      SAGA_EXCHANGES.commands,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true, contentType: 'application/json' },
    );
    if (!ok) {
      this.logger.warn({ routingKey }, 'Saga publish buffer full, applying backpressure');
      await new Promise<void>((resolve) => channel.once('drain', resolve));
    }
    this.logger.debug({ routingKey }, 'Saga command published');
  }

  /** Consume replies; invokes handler with the parsed reply. Auto-acks on resolve. */
  async consumeReplies(handler: (reply: ConfirmationResultReply) => Promise<void>): Promise<void> {
    const channel = await this.ready();
    await channel.consume(SAGA_QUEUES.replies, async (msg) => {
      if (!msg) return;
      try {
        const reply = JSON.parse(msg.content.toString()) as ConfirmationResultReply;
        await handler(reply);
        channel.ack(msg);
      } catch (err) {
        this.logger.error({ err }, 'Failed to process saga reply; discarding (no requeue)');
        channel.nack(msg, false, false);
      }
    });
    this.logger.info({ queue: SAGA_QUEUES.replies }, 'Saga reply consumer started');
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
