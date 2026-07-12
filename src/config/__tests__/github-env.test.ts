import { loadGithubServiceConfig } from '../github-env';

describe('loadGithubServiceConfig', () => {
  const OLD = process.env;
  beforeEach(() => {
    process.env = { ...OLD };
  });
  afterAll(() => {
    process.env = OLD;
  });

  it('throws when API_KEY missing', () => {
    process.env.API_KEY = '';
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(() => loadGithubServiceConfig()).toThrow('Missing required environment variable: API_KEY');
  });

  it('applies defaults', () => {
    process.env.API_KEY = 'k';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const cfg = loadGithubServiceConfig();
    expect(cfg.githubHttpPort).toBe(3200);
    expect(cfg.githubGrpcPort).toBe(50062);
    expect(cfg.githubApiBaseUrl).toBe('https://api.github.com');
    expect(cfg.githubCacheTtlSeconds).toBe(600);
  });
});
