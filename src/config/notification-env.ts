/**
 * Config for the standalone notification service.
 *
 * Deliberately a SEPARATE module from `env.ts` with NO import from it: importing
 * `env.ts` evaluates its eager `loadConfig()` singleton, which calls
 * `requireEnv('DATABASE_URL')`. The notification service has no database, so it
 * must not trigger that. This loader validates only what the notification process
 * actually needs, so `requireEnv` is duplicated here (trivial, avoids the side effect).
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
export interface NotificationServiceConfig {
  apiKey: string;
  emailProvider: 'resend' | 'mock';
  emailMockUrl: string;
  resendApiKey: string;
  emailFrom: string;
  baseUrl: string;
  rabbitmqUrl: string;
  retryDelayMs: number;
  maxAttempts: number;
  notificationHttpPort: number;
  notificationGrpcPort: number;
  nodeEnv: 'development' | 'production' | 'test';
}

export function loadNotificationConfig(): NotificationServiceConfig {
  const emailProvider = (process.env.EMAIL_PROVIDER as 'resend' | 'mock') || 'resend';
  return {
    apiKey: requireEnv('API_KEY'),
    emailProvider,
    emailMockUrl: process.env.EMAIL_MOCK_URL || 'http://localhost:4000',
    // Only required when actually sending through Resend.
    resendApiKey:
      emailProvider === 'resend'
        ? requireEnv('RESEND_API_KEY')
        : (process.env.RESEND_API_KEY ?? ''),
    emailFrom: process.env.EMAIL_FROM || 'GitHub Release Notifier <noreply@tweeedlex.xyz>',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    rabbitmqUrl: requireEnv('RABBITMQ_URL'),
    retryDelayMs: Number(process.env.NOTIF_RETRY_DELAY_MS) || 5000,
    maxAttempts: Number(process.env.NOTIF_MAX_ATTEMPTS) || 3,
    notificationHttpPort: Number(process.env.NOTIFICATION_HTTP_PORT) || 3100,
    notificationGrpcPort: Number(process.env.NOTIFICATION_GRPC_PORT) || 50061,
    nodeEnv: (process.env.NODE_ENV as NotificationServiceConfig['nodeEnv']) || 'development',
  };
}
