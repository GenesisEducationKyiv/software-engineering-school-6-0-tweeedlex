export interface Config {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  apiKey: string;
  githubToken?: string;
  resendApiKey: string;
  baseUrl: string;
  scanIntervalMs: number;
  grpcPort: number;
  nodeEnv: 'development' | 'production' | 'test';
  githubCacheTtlSeconds: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig(): Config {
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: requireEnv('REDIS_URL'),
    apiKey: requireEnv('API_KEY'),
    githubToken: process.env.GITHUB_TOKEN,
    resendApiKey: requireEnv('RESEND_API_KEY'),
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS) || 300000,
    grpcPort: Number(process.env.GRPC_PORT) || 50051,
    nodeEnv: (process.env.NODE_ENV as Config['nodeEnv']) || 'development',
    githubCacheTtlSeconds: Number(process.env.GH_CACHE_TTL_SECONDS) || 600,
  };
}

export const config = loadConfig();
