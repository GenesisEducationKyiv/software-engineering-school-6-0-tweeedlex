import path from 'node:path';
import type { ReleaseEventPayload } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { INotificationClient } from './notification-client.interface';

const PROTO_PATH = path.join(__dirname, '..', '..', '..', 'proto', 'notification.proto');

export class GrpcNotificationClient implements INotificationClient {
  // biome-ignore lint/suspicious/noExplicitAny: gRPC client is dynamically typed from the loaded proto
  private readonly client: any;
  private readonly metadata: grpc.Metadata;

  constructor(
    addr: string,
    apiKey: string,
    private readonly logger: ILogger,
  ) {
    const pkgDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    // biome-ignore lint/suspicious/noExplicitAny: loaded proto package is dynamically typed
    const proto = grpc.loadPackageDefinition(pkgDef) as any;
    this.client = new proto.notification.NotificationService(
      addr,
      grpc.credentials.createInsecure(),
    );
    this.metadata = new grpc.Metadata();
    this.metadata.add('x-api-key', apiKey);
  }

  private call(method: string, payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic gRPC method dispatch
      (this.client as any)[method](payload, this.metadata, (err: grpc.ServiceError | null) => {
        if (err) {
          this.logger.error({ err, method }, 'Notification gRPC call failed');
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  sendConfirmation(email: string, confirmToken: string, repo: string): Promise<void> {
    return this.call('sendConfirmation', { email, confirmToken, repo });
  }

  sendReleaseNotification(
    email: string,
    unsubscribeToken: string,
    repo: string,
    release: ReleaseEventPayload,
  ): Promise<void> {
    return this.call('sendReleaseNotification', { email, unsubscribeToken, repo, release });
  }

  close(): void {
    grpc.closeClient(this.client);
  }
}
