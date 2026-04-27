import supertest from 'supertest';
import { buildApp } from '../../../app';
import type { SubscriptionService } from '../subscription.service';

const TEST_API_KEY = 'test-api-key';
const VALID_TOKEN = 'o65C424UZUrHdYEzXom7NUq0TnZpvdXVy4tK2S5gcj8';
const VALID_TOKEN_2 = 'jd4JxYg7eDkZ2uuNtzRUgWVmV3xzEOK3AQSgcviVSUM';

const mockSubscriptionService: jest.Mocked<SubscriptionService> = {
  subscribe: jest.fn(),
  confirm: jest.fn(),
  unsubscribe: jest.fn(),
  getSubscriptions: jest.fn(),
} as unknown as jest.Mocked<SubscriptionService>;

async function createApp() {
  const app = await buildApp({
    subscriptionService: mockSubscriptionService,
    apiKey: TEST_API_KEY,
  });
  await app.ready();
  return app;
}

describe('Subscription Routes (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/subscribe', () => {
    it('should return 200 on successful subscription', async () => {
      mockSubscriptionService.subscribe.mockResolvedValue(undefined);

      const app = await createApp();
      const res = await supertest(app.server)
        .post('/api/subscribe')
        .set('x-api-key', TEST_API_KEY)
        .send({ email: 'test@example.com', repo: 'golang/go' });

      expect(res.status).toBe(200);
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledWith(
        'test@example.com',
        'golang/go',
      );

      await app.close();
    });

    it('should return 401 without API key', async () => {
      const app = await createApp();
      const res = await supertest(app.server)
        .post('/api/subscribe')
        .send({ email: 'test@example.com', repo: 'golang/go' });

      expect(res.status).toBe(401);
      expect(mockSubscriptionService.subscribe).not.toHaveBeenCalled();

      await app.close();
    });

    it('should return 401 with wrong API key', async () => {
      const app = await createApp();
      const res = await supertest(app.server)
        .post('/api/subscribe')
        .set('x-api-key', 'wrong-key')
        .send({ email: 'test@example.com', repo: 'golang/go' });

      expect(res.status).toBe(401);

      await app.close();
    });

    it('should return 400 for invalid body', async () => {
      const app = await createApp();
      const res = await supertest(app.server)
        .post('/api/subscribe')
        .set('x-api-key', TEST_API_KEY)
        .send({ email: 'not-an-email', repo: 'golang/go' });

      expect(res.status).toBe(400);

      await app.close();
    });
  });

  describe('GET /api/confirm/:token', () => {
    it('should return 200 on successful confirmation', async () => {
      mockSubscriptionService.confirm.mockResolvedValue(undefined);

      const app = await createApp();
      const res = await supertest(app.server).get(`/api/confirm/${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(mockSubscriptionService.confirm).toHaveBeenCalledWith(VALID_TOKEN);

      await app.close();
    });
  });

  describe('GET /api/unsubscribe/:token', () => {
    it('should return 200 on successful unsubscribe', async () => {
      mockSubscriptionService.unsubscribe.mockResolvedValue(undefined);

      const app = await createApp();
      const res = await supertest(app.server).get(`/api/unsubscribe/${VALID_TOKEN_2}`);

      expect(res.status).toBe(200);
      expect(mockSubscriptionService.unsubscribe).toHaveBeenCalledWith(VALID_TOKEN_2);

      await app.close();
    });
  });

  describe('GET /api/subscriptions', () => {
    it('should return subscriptions for valid email with API key', async () => {
      const mockSubs = [
        {
          email: 'test@example.com',
          repo: 'golang/go',
          confirmed: true,
          last_seen_tag: 'v1.22.0',
        },
      ];
      mockSubscriptionService.getSubscriptions.mockResolvedValue(mockSubs);

      const app = await createApp();
      const res = await supertest(app.server)
        .get('/api/subscriptions')
        .set('x-api-key', TEST_API_KEY)
        .query({ email: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockSubs);

      await app.close();
    });

    it('should return 401 without API key', async () => {
      const app = await createApp();
      const res = await supertest(app.server)
        .get('/api/subscriptions')
        .query({ email: 'test@example.com' });

      expect(res.status).toBe(401);

      await app.close();
    });

    it('should return 400 for invalid email', async () => {
      const app = await createApp();
      const res = await supertest(app.server)
        .get('/api/subscriptions')
        .set('x-api-key', TEST_API_KEY)
        .query({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(mockSubscriptionService.getSubscriptions).not.toHaveBeenCalled();

      await app.close();
    });

    it('should return empty array when no subscriptions', async () => {
      mockSubscriptionService.getSubscriptions.mockResolvedValue([]);

      const app = await createApp();
      const res = await supertest(app.server)
        .get('/api/subscriptions')
        .set('x-api-key', TEST_API_KEY)
        .query({ email: 'nobody@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);

      await app.close();
    });
  });

  describe('Error handling', () => {
    it('should return proper error for service exceptions', async () => {
      const { ConflictError } = await import('../../../shared/errors/app-error');
      mockSubscriptionService.subscribe.mockRejectedValue(new ConflictError('Already subscribed'));

      const app = await createApp();
      const res = await supertest(app.server)
        .post('/api/subscribe')
        .set('x-api-key', TEST_API_KEY)
        .send({ email: 'test@example.com', repo: 'golang/go' });

      expect(res.status).toBe(409);

      await app.close();
    });

    it('should return 400 for invalid token format', async () => {
      const app = await createApp();
      const res = await supertest(app.server).get('/api/confirm/bad-token');

      expect(res.status).toBe(400);
      expect(mockSubscriptionService.confirm).not.toHaveBeenCalled();

      await app.close();
    });

    it('should return 404 for valid token not found', async () => {
      const { NotFoundError } = await import('../../../shared/errors/app-error');
      mockSubscriptionService.confirm.mockRejectedValue(new NotFoundError('Token not found'));

      const app = await createApp();
      const res = await supertest(app.server).get(`/api/confirm/${VALID_TOKEN}`);

      expect(res.status).toBe(404);

      await app.close();
    });

    it('should return 429 for rate limit errors', async () => {
      const { RateLimitError } = await import('../../../shared/errors/app-error');
      mockSubscriptionService.subscribe.mockRejectedValue(new RateLimitError(60));

      const app = await createApp();
      const res = await supertest(app.server)
        .post('/api/subscribe')
        .set('x-api-key', TEST_API_KEY)
        .send({ email: 'test@example.com', repo: 'golang/go' });

      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe('60');

      await app.close();
    });
  });
});
