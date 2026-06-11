import path from 'node:path';
import type { ILogger } from '@/shared/logger';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { IngressService } from '../ingress.service';

const PROTO_PATH = path.join(__dirname, '..', '..', '..', '..', 'proto', 'notification.proto');

export interface NotificationGrpcDeps {
  ingress: IngressService;
  apiKey: string;
  logger: ILogger;
}

function checkKey(call: grpc.ServerUnaryCall<any, any>, apiKey: string): boolean {
  const m = call.metadata.get('x-api-key');
  return m.length > 0 && m[0] === apiKey;
}

export function buildNotificationGrpcServer(deps: NotificationGrpcDeps): grpc.Server {
  const pkgDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(pkgDef) as any;
  const server = new grpc.Server();

  server.addService(proto.notification.NotificationService.service, {
    sendConfirmation: async (call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) => {
      if (!checkKey(call, deps.apiKey)) {
        cb({ code: grpc.status.UNAUTHENTICATED, message: 'Unauthorized' });
        return;
      }
      try {
        const { email, confirmToken, repo } = call.request;
        const ack = await deps.ingress.enqueueConfirmation({ email, confirmToken, repo });
        cb(null, { status: ack.status, jobId: ack.jobId });
      } catch (err) {
        deps.logger.error({ err }, 'gRPC sendConfirmation failed');
        cb({ code: grpc.status.INTERNAL, message: 'Internal error' });
      }
    },

    sendReleaseNotification: async (
      call: grpc.ServerUnaryCall<any, any>,
      cb: grpc.sendUnaryData<any>,
    ) => {
      if (!checkKey(call, deps.apiKey)) {
        cb({ code: grpc.status.UNAUTHENTICATED, message: 'Unauthorized' });
        return;
      }
      try {
        const { email, unsubscribeToken, repo, release } = call.request;
        const ack = await deps.ingress.enqueueRelease({ email, unsubscribeToken, repo, release });
        cb(null, { status: ack.status, jobId: ack.jobId });
      } catch (err) {
        deps.logger.error({ err }, 'gRPC sendReleaseNotification failed');
        cb({ code: grpc.status.INTERNAL, message: 'Internal error' });
      }
    },
  });

  return server;
}

export function startNotificationGrpcServer(
  server: grpc.Server,
  port: number,
  logger: ILogger,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) {
        reject(err);
        return;
      }
      logger.info({ port }, 'Notification gRPC server listening');
      resolve();
    });
  });
}
