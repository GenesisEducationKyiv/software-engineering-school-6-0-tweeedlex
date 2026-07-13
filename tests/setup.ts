// Set required environment variables for tests
process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.API_KEY = 'test-api-key';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.BASE_URL = 'http://localhost:3000';
process.env.NODE_ENV = 'test';
