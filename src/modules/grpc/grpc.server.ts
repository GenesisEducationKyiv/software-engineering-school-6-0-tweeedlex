import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import type { GrpcObject, ServiceClientConstructor } from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { logger } from '../../config/logger';
import { AppError } from '../../shared/errors/app-error';
import type { SubscriptionService } from '../subscriptions/subscription.service';

interface SubscribeRequest {
  email: string;
  repo: string;
}

interface TokenRequest {
  token: string;
}

interface GetSubscriptionsRequest {
  email: string;
  apiKey: string;
}

interface SubscriptionResponse {
  message: string;
}

interface GetSubscriptionsResponse {
  subscriptions: Array<{
    email: string;
    repo: string;
    confirmed: boolean;
    lastSeenTag: string;
  }>;
}

interface SubscriptionPackage extends GrpcObject {
  subscription: {
    SubscriptionService: ServiceClientConstructor;
  } & GrpcObject;
}

const PROTO_PATH = path.join(__dirname, '..', '..', '..', 'proto', 'subscription.proto');

function mapAppErrorToGrpcStatus(err: AppError): grpc.status {
  switch (err.statusCode) {
    case 400:
      return grpc.status.INVALID_ARGUMENT;
    case 401:
      return grpc.status.UNAUTHENTICATED;
    case 404:
      return grpc.status.NOT_FOUND;
    case 409:
      return grpc.status.ALREADY_EXISTS;
    case 429:
      return grpc.status.RESOURCE_EXHAUSTED;
    default:
      return grpc.status.INTERNAL;
  }
}

function handleError<T>(err: unknown, callback: grpc.sendUnaryData<T>) {
  if (err instanceof AppError) {
    callback({
      code: mapAppErrorToGrpcStatus(err),
      message: err.message,
    });
  } else {
    logger.error(err, 'Unexpected gRPC error');
    callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error',
    });
  }
}

export interface GrpcServerDeps {
  subscriptionService: SubscriptionService;
  apiKey: string;
}

export function buildGrpcServer(deps: GrpcServerDeps): grpc.Server {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDefinition) as SubscriptionPackage;
  const server = new grpc.Server();

  server.addService(proto.subscription.SubscriptionService.service, {
    subscribe: async (
      call: grpc.ServerUnaryCall<SubscribeRequest, SubscriptionResponse>,
      callback: grpc.sendUnaryData<SubscriptionResponse>,
    ) => {
      try {
        const { email, repo } = call.request;
        const metadata = call.metadata.get('x-api-key');
        const providedKey = metadata.length > 0 ? metadata[0] : null;

        if (!providedKey || providedKey !== deps.apiKey) {
          callback({
            code: grpc.status.UNAUTHENTICATED,
            message: 'Unauthorized: Invalid or missing API key',
          });
          return;
        }

        await deps.subscriptionService.subscribe(email, repo);
        callback(null, { message: 'Subscription successful. Confirmation email sent.' });
      } catch (err) {
        handleError(err, callback);
      }
    },

    confirm: async (
      call: grpc.ServerUnaryCall<TokenRequest, SubscriptionResponse>,
      callback: grpc.sendUnaryData<SubscriptionResponse>,
    ) => {
      try {
        const { token } = call.request;
        await deps.subscriptionService.confirm(token);
        callback(null, { message: 'Subscription confirmed successfully' });
      } catch (err) {
        handleError(err, callback);
      }
    },

    unsubscribe: async (
      call: grpc.ServerUnaryCall<TokenRequest, SubscriptionResponse>,
      callback: grpc.sendUnaryData<SubscriptionResponse>,
    ) => {
      try {
        const { token } = call.request;
        await deps.subscriptionService.unsubscribe(token);
        callback(null, { message: 'Unsubscribed successfully' });
      } catch (err) {
        handleError(err, callback);
      }
    },

    getSubscriptions: async (
      call: grpc.ServerUnaryCall<GetSubscriptionsRequest, GetSubscriptionsResponse>,
      callback: grpc.sendUnaryData<GetSubscriptionsResponse>,
    ) => {
      try {
        const { email, apiKey: providedKey } = call.request;
        const metadataKey = call.metadata.get('x-api-key');
        const key = metadataKey.length > 0 ? metadataKey[0] : providedKey;

        if (!key || key !== deps.apiKey) {
          callback({
            code: grpc.status.UNAUTHENTICATED,
            message: 'Unauthorized: Invalid or missing API key',
          });
          return;
        }

        const subscriptions = await deps.subscriptionService.getSubscriptions(email);
        callback(null, {
          subscriptions: subscriptions.map((s) => ({
            email: s.email,
            repo: s.repo,
            confirmed: s.confirmed,
            lastSeenTag: s.last_seen_tag || '',
          })),
        });
      } catch (err) {
        handleError(err, callback);
      }
    },
  });

  return server;
}

export function startGrpcServer(server: grpc.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) {
        reject(err);
        return;
      }
      logger.info(`gRPC server listening on port ${port}`);
      resolve();
    });
  });
}
