import * as grpc from '@grpc/grpc-js';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
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
  let app: FastifyInstance;

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

    mockClient.subscribe.mockImplementation(
      (_payload: unknown, _metadata: unknown, callback: (err: unknown, res: null) => void) => {
        callback(grpcError, null);
      },
    );

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

    mockClient.subscribe.mockImplementation(
      (_payload: unknown, _metadata: unknown, callback: (err: unknown, res: null) => void) => {
        callback(grpcError, null);
      },
    );

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
});
