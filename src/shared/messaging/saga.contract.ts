/** Dedicated exchanges for the orchestrated saga; separate from the HW7 `notifications` exchange. */
export const SAGA_EXCHANGES = {
  commands: 'saga.commands',
  replies: 'saga.replies',
} as const;

/** Routing keys for saga commands and replies on their respective exchanges. */
export const SAGA_ROUTING_KEYS = {
  sendConfirmation: 'saga.send-confirmation',
  confirmationResult: 'saga.confirmation-result',
} as const;

/** Bump on a breaking saga payload change. */
export const SAGA_SCHEMA_VERSION = 1 as const;

/** Command: orchestrator -> notification service. */
export interface SendConfirmationCommand {
  v: typeof SAGA_SCHEMA_VERSION;
  sagaId: string;
  email: string;
  confirmToken: string;
  repo: string;
}

/** Reply: notification service -> orchestrator. */
export interface ConfirmationResultReply {
  v: typeof SAGA_SCHEMA_VERSION;
  sagaId: string;
  success: boolean;
  error?: string;
}
