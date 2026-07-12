import type { ILogger } from '@/shared/logger';
import {
  type ConfirmationResultReply,
  type RabbitMqConnection,
  SAGA_EXCHANGES,
  SAGA_ROUTING_KEYS,
  SAGA_SCHEMA_VERSION,
  type SendConfirmationCommand,
} from '@/shared/messaging';

const COMMANDS_QUEUE = 'saga.commands.confirmation';
const PREFETCH = 10;

/** Declares the same saga topology the orchestrator uses; idempotent. */
async function assertNotifSagaTopology(
  channel: Awaited<ReturnType<RabbitMqConnection['getChannel']>>,
) {
  await channel.assertExchange(SAGA_EXCHANGES.commands, 'direct', { durable: true });
  await channel.assertExchange(SAGA_EXCHANGES.replies, 'direct', { durable: true });
  await channel.assertQueue(COMMANDS_QUEUE, { durable: true });
  await channel.bindQueue(
    COMMANDS_QUEUE,
    SAGA_EXCHANGES.commands,
    SAGA_ROUTING_KEYS.sendConfirmation,
  );
}

export class NotifSagaBroker {
  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly logger: ILogger,
  ) {}

  async start(
    handler: (cmd: SendConfirmationCommand) => Promise<ConfirmationResultReply>,
  ): Promise<void> {
    const channel = await this.connection.getChannel();
    await assertNotifSagaTopology(channel);
    await channel.prefetch(PREFETCH);

    await channel.consume(COMMANDS_QUEUE, async (msg) => {
      if (!msg) return;
      try {
        const raw = JSON.parse(msg.content.toString()) as { v?: number };
        if (raw.v !== SAGA_SCHEMA_VERSION) {
          this.logger.error({ v: raw.v }, 'Saga command has unexpected schema version; dropping');
          channel.nack(msg, false, false);
          return;
        }
        const cmd = raw as SendConfirmationCommand;
        const reply = await handler(cmd);
        channel.publish(
          SAGA_EXCHANGES.replies,
          SAGA_ROUTING_KEYS.confirmationResult,
          Buffer.from(JSON.stringify(reply)),
          { persistent: true, contentType: 'application/json' },
        );
        channel.ack(msg);
      } catch (err) {
        this.logger.error({ err }, 'Saga command processing failed; dropping');
        channel.nack(msg, false, false);
      }
    });
    this.logger.info({ queue: COMMANDS_QUEUE }, 'Saga command consumer started');
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
