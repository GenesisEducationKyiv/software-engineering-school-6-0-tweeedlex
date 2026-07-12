import type {
  BrokerMessage,
  ConsumeResult,
  NewReleaseDetectedMessage,
  NotificationWireMessage,
} from '@/shared/messaging';
import { ROUTING_KEYS } from '@/shared/messaging';
import type { NotificationService } from './internal/notification.service';

/**
 * Builds the consumer handler that maps a parsed wire message to the
 * NotificationService. Returns 'ack' on success, 'retry' on a transient
 * service failure, 'reject' for an unroutable message (sent to parking-lot).
 */
export function buildNotificationConsumerHandler(service: NotificationService) {
  return async (msg: BrokerMessage<NotificationWireMessage>): Promise<ConsumeResult> => {
    try {
      if (msg.routingKey === ROUTING_KEYS.RELEASE_DETECTED) {
        const p = msg.payload as NewReleaseDetectedMessage;
        for (const sub of p.subscribers) {
          await service.sendReleaseNotification(sub.email, sub.unsubscribeToken, p.repo, p.release);
        }
        return 'ack';
      }
      return 'reject';
    } catch {
      return 'retry';
    }
  };
}
