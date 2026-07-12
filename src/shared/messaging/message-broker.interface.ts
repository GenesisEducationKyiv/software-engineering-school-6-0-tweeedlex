/** Result a consumer handler returns; the consumer maps it to ack/nack. */
export type ConsumeResult = 'ack' | 'retry' | 'reject';

export interface BrokerMessage<T> {
  /** Routing key the message arrived on. */
  readonly routingKey: string;
  /** Parsed JSON payload. */
  readonly payload: T;
  /** How many times delivery has already been retried (from x-death). */
  readonly attempt: number;
}

export type MessageHandler<T> = (message: BrokerMessage<T>) => Promise<ConsumeResult>;

export interface IMessagePublisher {
  publish<T>(routingKey: string, payload: T): Promise<void>;
  close(): Promise<void>;
}

export interface IMessageConsumer {
  /** Start consuming the bound queue. Resolves once consumption is registered. */
  start<T>(handler: MessageHandler<T>): Promise<void>;
  close(): Promise<void>;
}
