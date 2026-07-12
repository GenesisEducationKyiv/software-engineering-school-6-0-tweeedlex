import { loadNotificationConfig } from '@/config/notification-env';

describe('loadNotificationConfig', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('loads without DATABASE_URL (notification service has no database)', () => {
    process.env.DATABASE_URL = undefined;
    // biome-ignore lint/performance/noDelete: test needs the var truly absent
    delete process.env.DATABASE_URL;
    process.env.RABBITMQ_URL = 'amqp://localhost:5672';
    process.env.API_KEY = 'k';
    process.env.EMAIL_PROVIDER = 'mock';

    const cfg = loadNotificationConfig();

    expect(cfg.rabbitmqUrl).toBe('amqp://localhost:5672');
    expect(cfg.retryDelayMs).toBe(5000);
    expect(cfg.maxAttempts).toBe(3);
    expect(cfg.apiKey).toBe('k');
    expect(cfg.emailProvider).toBe('mock');
    expect(cfg.notificationHttpPort).toBe(3100);
    expect(cfg.notificationGrpcPort).toBe(50061);
  });

  it('does not require RESEND_API_KEY under the mock provider', () => {
    // biome-ignore lint/performance/noDelete: test needs the var truly absent
    delete process.env.RESEND_API_KEY;
    process.env.RABBITMQ_URL = 'amqp://localhost:5672';
    process.env.API_KEY = 'k';
    process.env.EMAIL_PROVIDER = 'mock';

    expect(() => loadNotificationConfig()).not.toThrow();
  });

  it('requires RESEND_API_KEY under the resend provider', () => {
    // biome-ignore lint/performance/noDelete: test needs the var truly absent
    delete process.env.RESEND_API_KEY;
    process.env.RABBITMQ_URL = 'amqp://localhost:5672';
    process.env.API_KEY = 'k';
    process.env.EMAIL_PROVIDER = 'resend';

    expect(() => loadNotificationConfig()).toThrow(/RESEND_API_KEY/);
  });
});
