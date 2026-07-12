// src/composition/saga-reply-consumer.ts
import type { ConfirmationSaga, SagaBroker } from '@/modules/saga';

/** Subscribes the saga broker's reply stream to the orchestrator. */
export async function startSagaReplyConsumer(
  broker: SagaBroker,
  saga: ConfirmationSaga,
): Promise<void> {
  await broker.consumeReplies((reply) => saga.handleReply(reply));
}
