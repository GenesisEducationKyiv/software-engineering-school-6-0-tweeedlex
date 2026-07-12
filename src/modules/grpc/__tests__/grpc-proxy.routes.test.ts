import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { grpcProxyRoutes } from '../grpc-proxy.routes';
import type { IGrpcProxyService } from '../grpc-proxy.service';

const mockProxyService: jest.Mocked<IGrpcProxyService> = {
  call: jest.fn(),
  close: jest.fn(),
};

describe('gRPC Proxy Routes', () => {
  const TEST_API_KEY = 'test-api-key';
  let app: FastifyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = Fastify();
    await app.register(grpcProxyRoutes, {
      proxyService: mockProxyService,
      apiKey: TEST_API_KEY,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should parse gRPC error message correctly', async () => {
    mockProxyService.call.mockResolvedValue({
      status: 409,
      body: { message: 'Email 7545245@gmail.com is already subscribed to tweeedlex/test.' },
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

  it('should return 400 for bad method', async () => {
    mockProxyService.call.mockResolvedValue({
      status: 400,
      body: { message: 'Unknown gRPC method: BadMethod' },
    });

    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({
        method: 'BadMethod',
        payload: {},
      });

    expect(res.status).toBe(400);
  });

  it('should return 401 without API key', async () => {
    const res = await supertest(app.server)
      .post('/grpc-proxy')
      .send({
        method: 'Subscribe',
        payload: { email: 'test@example.com', repo: 'tweeedlex/test' },
      });

    expect(res.status).toBe(401);
    expect(mockProxyService.call).not.toHaveBeenCalled();
  });

  it('should call proxyService with correct args', async () => {
    mockProxyService.call.mockResolvedValue({ status: 200, body: { message: 'OK' } });

    await supertest(app.server)
      .post('/grpc-proxy')
      .set('x-api-key', TEST_API_KEY)
      .send({
        method: 'Subscribe',
        payload: { email: 'test@example.com', repo: 'tweeedlex/test' },
      });

    expect(mockProxyService.call).toHaveBeenCalledWith(
      'Subscribe',
      { email: 'test@example.com', repo: 'tweeedlex/test' },
      TEST_API_KEY,
    );
  });
});
