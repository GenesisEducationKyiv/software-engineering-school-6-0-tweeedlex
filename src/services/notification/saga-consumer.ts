import {
  type ConfirmationResultReply,
  SAGA_SCHEMA_VERSION,
  type SendConfirmationCommand,
} from '@/shared/messaging';
import type { NotificationService } from './internal/notification.service';

/**
 * Maps a send-confirmation command to an email send and a reply. Never throws:
 * a failed email becomes a success:false reply so the orchestrator can compensate.
 */
export function buildSagaCommandHandler(service: NotificationService) {
  return async (cmd: SendConfirmationCommand): Promise<ConfirmationResultReply> => {
    try {
      await service.sendConfirmationEmail(cmd.email, cmd.confirmToken, cmd.repo);
      return { v: SAGA_SCHEMA_VERSION, sagaId: cmd.sagaId, success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { v: SAGA_SCHEMA_VERSION, sagaId: cmd.sagaId, success: false, error };
    }
  };
}
