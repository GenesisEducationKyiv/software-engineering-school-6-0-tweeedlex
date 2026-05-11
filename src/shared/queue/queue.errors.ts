export class QueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueError';
  }
}
export class QueueConnectionError extends QueueError {}
export class JobEnqueueError extends QueueError {}
