import { APP_BASE_URL, prisma, resetState } from './helpers';

describe('GET /api/metrics', () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns Prometheus metrics including HTTP request counters', async () => {
    await fetch(`${APP_BASE_URL}/api/metrics`);

    const response = await fetch(`${APP_BASE_URL}/api/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain('http_requests_total');
  });
});
