import type { ILogger } from '../logger';
import type { DomainEvent, EventHandler, IEventBus } from './event-bus.interface';

export class InProcessEventBus implements IEventBus {
  private readonly handlers = new Map<string, EventHandler<DomainEvent>[]>();

  constructor(private readonly logger: ILogger) {}

  async publish<E extends DomainEvent>(event: E): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    const errors: unknown[] = [];
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        this.logger.error({ err, eventType: event.type }, 'Event handler failed');
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more event handlers failed');
    }
  }

  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): () => void {
    const list = this.handlers.get(type) ?? [];
    const domainHandler = handler as EventHandler<DomainEvent>;
    list.push(domainHandler);
    this.handlers.set(type, list);
    return () => {
      const current = this.handlers.get(type) ?? [];
      this.handlers.set(
        type,
        current.filter((h) => h !== domainHandler),
      );
    };
  }
}
