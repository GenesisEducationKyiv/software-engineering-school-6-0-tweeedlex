import { APP_BASE_URL, useIsolatedState } from './helpers';

describe('GET /api/metrics', () => {
  useIsolatedState();

  it('returns Prometheus metrics including HTTP request counters', async () => {
    await fetch(`${APP_BASE_URL}/api/metrics`);

    const response = await fetch(`${APP_BASE_URL}/api/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain('http_requests_total');
  });
});
