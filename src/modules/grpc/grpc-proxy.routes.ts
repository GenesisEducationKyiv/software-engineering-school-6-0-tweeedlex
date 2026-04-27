import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createApiKeyGuard } from '../auth/api-key.plugin';

const PROTO_PATH = path.join(__dirname, '..', '..', '..', 'proto', 'subscription.proto');

interface GrpcProxyOptions {
  grpcPort: number;
  apiKey: string;
}

interface GrpcProxyBody {
  method: string;
  payload: Record<string, unknown>;
}

const grpcProxyPlugin: FastifyPluginAsync<GrpcProxyOptions> = async (
  fastify: FastifyInstance,
  options: GrpcProxyOptions,
) => {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDefinition) as any;

  const client = new proto.subscription.SubscriptionService(
    `localhost:${options.grpcPort}`,
    grpc.credentials.createInsecure(),
  );

  const apiKeyGuard = createApiKeyGuard(options.apiKey);

  fastify.post<{ Body: GrpcProxyBody }>(
    '/grpc-proxy',
    { preHandler: [apiKeyGuard] },
    async (request, reply) => {
      const { method, payload } = request.body;
      const apiKey = request.headers['x-api-key'] as string;

      const allowedMethods = ['Subscribe', 'Confirm', 'Unsubscribe', 'GetSubscriptions'];
      if (!allowedMethods.includes(method)) {
        return reply.status(400).send({ message: `Unknown gRPC method: ${method}` });
      }

      const methodName = method.charAt(0).toLowerCase() + method.slice(1);

      const metadata = new grpc.Metadata();
      metadata.add('x-api-key', apiKey);

      return new Promise((resolve) => {
        client[methodName](payload, metadata, (err: grpc.ServiceError | null, response: any) => {
          if (err) {
            const statusMap: Record<number, number> = {
              [grpc.status.INVALID_ARGUMENT]: 400,
              [grpc.status.UNAUTHENTICATED]: 401,
              [grpc.status.NOT_FOUND]: 404,
              [grpc.status.ALREADY_EXISTS]: 409,
              [grpc.status.RESOURCE_EXHAUSTED]: 429,
            };
            const httpStatus = statusMap[err.code] || 500;
            const message = err.details || err.message.replace(/^[0-9]+\s+[A-Z_]+:\s*/, '');
            resolve(reply.status(httpStatus).send({ message }));
          } else {
            resolve(reply.status(200).send(response));
          }
        });
      });
    },
  );
};

export const grpcProxyRoutes = grpcProxyPlugin;
