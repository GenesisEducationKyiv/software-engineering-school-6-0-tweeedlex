import path from 'node:path';
import type { ILogger } from '@/shared/logger';
import * as grpc from '@grpc/grpc-js';
import type { GrpcObject } from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

type GrpcProxyMethod = (
  payload: Record<string, unknown>,
  metadata: grpc.Metadata,
  callback: (err: grpc.ServiceError | null, response: Record<string, unknown>) => void,
) => void;

interface GrpcClient {
  [method: string]: GrpcProxyMethod;
}

interface SubscriptionServiceClientConstructor {
  new (address: string, credentials: grpc.ChannelCredentials): GrpcClient;
}

interface SubscriptionPackage extends GrpcObject {
  subscription: {
    SubscriptionService: SubscriptionServiceClientConstructor;
  } & GrpcObject;
}

const PROTO_PATH = path.join(__dirname, '..', '..', '..', 'proto', 'subscription.proto');

const ALLOWED_METHODS = ['Subscribe', 'Confirm', 'Unsubscribe', 'GetSubscriptions'] as const;

const GRPC_TO_HTTP: Record<number, number> = {
  [grpc.status.INVALID_ARGUMENT]: 400,
  [grpc.status.UNAUTHENTICATED]: 401,
  [grpc.status.NOT_FOUND]: 404,
  [grpc.status.ALREADY_EXISTS]: 409,
  [grpc.status.RESOURCE_EXHAUSTED]: 429,
};

export interface GrpcProxyResult {
  status: number;
  body: unknown;
}

export interface IGrpcProxyService {
  call(method: string, payload: Record<string, unknown>, apiKey: string): Promise<GrpcProxyResult>;
  close(): void;
}

export class GrpcProxyService implements IGrpcProxyService {
  private client: GrpcClient;

  constructor(deps: { grpcPort: number; logger: ILogger }) {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(packageDefinition) as SubscriptionPackage;
    this.client = new proto.subscription.SubscriptionService(
      `localhost:${deps.grpcPort}`,
      grpc.credentials.createInsecure(),
    );
    deps.logger.info({ grpcPort: deps.grpcPort }, 'GrpcProxyService initialized');
  }

  call(method: string, payload: Record<string, unknown>, apiKey: string): Promise<GrpcProxyResult> {
    if (!(ALLOWED_METHODS as readonly string[]).includes(method)) {
      return Promise.resolve({ status: 400, body: { message: `Unknown gRPC method: ${method}` } });
    }
    const methodName = method.charAt(0).toLowerCase() + method.slice(1);
    const metadata = new grpc.Metadata();
    metadata.add('x-api-key', apiKey);

    return new Promise((resolve) => {
      this.client[methodName](
        payload,
        metadata,
        (err: grpc.ServiceError | null, response: Record<string, unknown>) => {
          if (err) {
            const httpStatus = GRPC_TO_HTTP[err.code] || 500;
            const message = err.details || err.message.replace(/^[0-9]+\s+[A-Z_]+:\s*/, '');
            resolve({ status: httpStatus, body: { message } });
          } else {
            resolve({ status: 200, body: response });
          }
        },
      );
    });
  }

  close(): void {
    grpc.closeClient(this.client as unknown as grpc.Client);
  }
}
