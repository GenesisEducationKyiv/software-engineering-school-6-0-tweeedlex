export interface Config {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  apiKey: string;
  githubToken?: string;
  githubApiBaseUrl: string;
  resendApiKey: string;
  emailProvider: 'resend' | 'mock';
  emailMockUrl: string;
  baseUrl: string;
  scanIntervalMs: number;
  grpcPort: number;
  nodeEnv: 'development' | 'production' | 'test';
  githubCacheTtlSeconds: number;
  emailFrom: string;
  serviceName: string;
  notificationHttpUrl: string;
  notificationGrpcAddr: string;
  notificationTransport: 'http' | 'grpc';
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
    githubApiBaseUrl: process.env.GITHUB_API_BASE_URL || 'https://api.github.com',
    resendApiKey: requireEnv('RESEND_API_KEY'),
    emailProvider: (process.env.EMAIL_PROVIDER as Config['emailProvider']) || 'resend',
    emailMockUrl: process.env.EMAIL_MOCK_URL || 'http://localhost:4000',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS) || 300000,
    grpcPort: Number(process.env.GRPC_PORT) || 50051,
    nodeEnv: (process.env.NODE_ENV as Config['nodeEnv']) || 'development',
    githubCacheTtlSeconds: Number(process.env.GH_CACHE_TTL_SECONDS) || 600,
    emailFrom: process.env.EMAIL_FROM || 'GitHub Release Notifier <noreply@tweeedlex.xyz>',
    serviceName: process.env.SERVICE_NAME || 'github-subscriptions-service',
    notificationHttpUrl: process.env.NOTIFICATION_HTTP_URL || 'http://localhost:3100',
    notificationGrpcAddr: process.env.NOTIFICATION_GRPC_ADDR || 'localhost:50061',
    notificationTransport: (process.env.NOTIFICATION_TRANSPORT as 'http' | 'grpc') || 'http',
  };
}

export const config = loadConfig();
