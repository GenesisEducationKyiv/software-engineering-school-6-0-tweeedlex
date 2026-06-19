import type { ILogger } from '@/shared/logger';
import type { IMessagePublisher } from '../message-broker.interface';
import type { RabbitMqConnection } from './rabbitmq-connection';
import { TOPOLOGY, type TopologyOptions, assertTopology } from './topology';

export class RabbitMqPublisher implements IMessagePublisher {
  private asserted = false;

  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly topologyOpts: TopologyOptions,
    private readonly logger: ILogger,
  ) {}

  async publish<T>(routingKey: string, payload: T): Promise<void> {
    const channel = await this.connection.getChannel();
    if (!this.asserted) {
      await assertTopology(channel, this.topologyOpts);
      this.asserted = true;
    }
    const body = Buffer.from(JSON.stringify(payload));
    const ok = channel.publish(TOPOLOGY.exchange, routingKey, body, {
      persistent: true,
      contentType: 'application/json',
    });
    if (!ok) {
      this.logger.warn({ routingKey }, 'RabbitMQ publish buffer full, applying backpressure');
      await new Promise<void>((resolve) => channel.once('drain', resolve));
    }
    this.logger.debug({ routingKey }, 'Message published');
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
