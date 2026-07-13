import type { GitHubRepo } from '@/modules/github';
import { NotFoundError } from '@/shared/errors/app-error';
import { PinoLogger } from '@/shared/logger';
import { buildGithubHttpServer } from '../server';

const repo: GitHubRepo = {
  id: 1,
  full_name: 'a/b',
  name: 'b',
  owner: { login: 'a' },
  description: null,
  html_url: 'https://x',
  private: false,
};

function makeServer(over: Partial<{ verifyRepo: jest.Mock }> = {}) {
  const service = {
    verifyRepo: over.verifyRepo ?? jest.fn().mockResolvedValue(repo),
    getLatestRelease: jest.fn().mockResolvedValue(null),
  };
  const logger = PinoLogger.create({ level: 'silent', pretty: false, base: { service: 'test' } });
  return buildGithubHttpServer({ service: service as never, apiKey: 'k', logger });
}

describe('github http server', () => {
  it('401 without api key', async () => {
    const app = await makeServer();
    const res = await app.inject({ method: 'GET', url: '/internal/repos/a/b' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('200 + repo with valid api key', async () => {
    const app = await makeServer();
    const res = await app.inject({
      method: 'GET',
      url: '/internal/repos/a/b',
      headers: { 'x-api-key': 'k' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().full_name).toBe('a/b');
    await app.close();
  });

  it('404 maps NotFoundError', async () => {
    const app = await makeServer({
      verifyRepo: jest.fn().mockRejectedValue(new NotFoundError('nope')),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/internal/repos/a/b',
      headers: { 'x-api-key': 'k' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('handler is not called without valid api key', async () => {
    const verifyRepo = jest.fn().mockResolvedValue(repo);
    const app = await makeServer({ verifyRepo });
    await app.inject({ method: 'GET', url: '/internal/repos/a/b' });
    expect(verifyRepo).not.toHaveBeenCalled();
    await app.close();
  });
});
