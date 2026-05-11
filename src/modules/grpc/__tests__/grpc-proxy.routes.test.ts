import * as grpc from '@grpc/grpc-js';
import Fastify from 'fastify';
import supertest from 'supertest';
import { grpcProxyRoutes } from '../grpc-proxy.routes';

const mockClient = {
  subscribe: jest.fn(),
  confirm: jest.fn(),
  unsubscribe: jest.fn(),
  getSubscriptions: jest.fn(),
};

// Mock grpc and protoLoader
jest.mock('@grpc/grpc-js', () => {
  const original = jest.requireActual('@grpc/grpc-js');
  return {
    ...original,
    loadPackageDefinition: jest.fn().mockReturnValue({
      subscription: {
        SubscriptionService: jest.fn().mockImplementation(() => mockClient),
      },
    }),
    credentials: {
      createInsecure: jest.fn(),
    },
    Metadata: jest.fn().mockImplementation(() => ({
      add: jest.fn(),
    })),
  };
});

jest.mock('@grpc/proto-loader', () => ({
  loadSync: jest.fn().mockReturnValue({}),
}));

describe('gRPC Proxy Routes', () => {
  const TEST_API_KEY = 'test-api-key';
  let app: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = Fastify();
    await app.register(grpcProxyRoutes, {
      grpcPort: 50051,
      apiKey: TEST_API_KEY,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should parse gRPC error message correctly', async () => {
    const grpcError = {
      code: grpc.status.ALREADY_EXISTS,
      message: '6 ALREADY_EXISTS: Email 7545245@gmail.com is already subscribed to tweeedlex/test.',
      details: 'Email 7545245@gmail.com is already subscribed to tweeedlex/test.',
    };

    mockClient.subscribe.mockImplementation((_payload: any, _metadata: any, callback: any) => {
      callback(grpcError, null);
    });

    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({
        method: 'Subscribe',
        payload: { email: 'test@example.com', repo: 'tweeedlex/test' },
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'Email 7545245@gmail.com is already subscribed to tweeedlex/test.',
    );
  });

  it('should fallback to regex if details is missing', async () => {
    const grpcError = {
      code: grpc.status.INVALID_ARGUMENT,
      message: '3 INVALID_ARGUMENT: Invalid email format',
      // details is missing
    };

    mockClient.subscribe.mockImplementation((_payload: any, _metadata: any, callback: any) => {
      callback(grpcError, null);
    });

    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({
        method: 'Subscribe',
        payload: { email: 'invalid', repo: 'tweeedlex/test' },
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid email format');
  });

  it('should return 200 with response body on success', async () => {
    mockClient.subscribe.mockImplementation((_payload: any, _metadata: any, callback: any) => {
      callback(null, { message: 'Subscription successful. Confirmation email sent.' });
    });

    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({ method: 'Subscribe', payload: { email: 'test@example.com', repo: 'golang/go' } });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Subscription successful. Confirmation email sent.');
  });

  it('should return 400 for unknown gRPC method', async () => {
    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({ method: 'DeleteAllData', payload: {} });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Unknown gRPC method: DeleteAllData');
  });

  it('should map NOT_FOUND to 404', async () => {
    mockClient.confirm.mockImplementation((_payload: any, _metadata: any, callback: any) => {
      callback({ code: grpc.status.NOT_FOUND, details: 'Token not found' }, null);
    });

    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({ method: 'Confirm', payload: { token: 'badtoken' } });

    expect(res.status).toBe(404);
  });

  it('should map UNAUTHENTICATED to 401', async () => {
    mockClient.confirm.mockImplementation((_payload: any, _metadata: any, callback: any) => {
      callback({ code: grpc.status.UNAUTHENTICATED, details: 'Invalid API key' }, null);
    });

    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({ method: 'Confirm', payload: { token: 'sometoken' } });

    expect(res.status).toBe(401);
  });

  it('should map RESOURCE_EXHAUSTED to 429', async () => {
    mockClient.subscribe.mockImplementation((_payload: any, _metadata: any, callback: any) => {
      callback({ code: grpc.status.RESOURCE_EXHAUSTED, details: 'Rate limit exceeded' }, null);
    });

    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({ method: 'Subscribe', payload: { email: 'test@example.com', repo: 'golang/go' } });

    expect(res.status).toBe(429);
  });

  it('should map unmapped gRPC status to 500', async () => {
    mockClient.subscribe.mockImplementation((_payload: any, _metadata: any, callback: any) => {
      callback({ code: grpc.status.INTERNAL, message: '13 INTERNAL: unexpected error' }, null);
    });

    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({ method: 'Subscribe', payload: { email: 'test@example.com', repo: 'golang/go' } });

    expect(res.status).toBe(500);
  });
});
