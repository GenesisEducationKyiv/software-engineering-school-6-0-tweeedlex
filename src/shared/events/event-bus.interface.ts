export interface DomainEvent { readonly type: string; }
export type EventHandler<E> = (event: E) => void | Promise<void>;
export interface IEventBus {
  publish<E extends DomainEvent>(event: E): Promise<void>;
  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): () => void;
}
