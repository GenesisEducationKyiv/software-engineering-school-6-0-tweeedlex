/**
 * Config for the standalone github-service.
 *
 * Deliberately a SEPARATE module from `env.ts` with NO import from it: importing
 * `env.ts` evaluates its eager `loadConfig()` singleton, which calls
 * `requireEnv('DATABASE_URL')`. The github-service has no database, so it must not
 * trigger that. `requireEnv` is duplicated here (trivial, avoids the side effect),
 * matching the notification-env.ts precedent.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface GithubServiceConfig {
  apiKey: string;
  redisUrl: string;
  githubToken?: string;
  githubApiBaseUrl: string;
  githubCacheTtlSeconds: number;
  githubHttpPort: number;
  githubGrpcPort: number;
  nodeEnv: 'development' | 'production' | 'test';
}

export function loadGithubServiceConfig(): GithubServiceConfig {
  return {
    apiKey: requireEnv('API_KEY'),
    redisUrl: requireEnv('REDIS_URL'),
    githubToken: process.env.GITHUB_TOKEN,
    githubApiBaseUrl: process.env.GITHUB_API_BASE_URL || 'https://api.github.com',
    githubCacheTtlSeconds: Number(process.env.GH_CACHE_TTL_SECONDS) || 600,
    githubHttpPort: Number(process.env.GITHUB_HTTP_PORT) || 3200,
    githubGrpcPort: Number(process.env.GITHUB_GRPC_PORT) || 50062,
    nodeEnv: (process.env.NODE_ENV as GithubServiceConfig['nodeEnv']) || 'development',
  };
}
