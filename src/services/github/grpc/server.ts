import type { IGitHubService } from '@/modules/github';
import { AppError } from '@/shared/errors/app-error';
import type { ILogger } from '@/shared/logger';
import type { GitHubServiceServer } from '@/generated/proto/github';
import { GitHubServiceService } from '@/generated/proto/github';
import * as grpc from '@grpc/grpc-js';
import { repoToProto, releaseToProto } from './mappers';

export interface GithubGrpcDeps {
  service: IGitHubService;
  apiKey: string;
  logger: ILogger;
}

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

function handleError(
  err: unknown,
  callback: grpc.sendUnaryData<any>,
  logger: ILogger,
): void {
  if (err instanceof AppError) {
    callback({ code: mapAppErrorToGrpcStatus(err), message: err.message });
  } else {
    logger.error({ err }, 'Unexpected github gRPC error');
    callback({ code: grpc.status.INTERNAL, message: 'Internal server error' });
  }
}

function checkApiKey(call: grpc.ServerUnaryCall<unknown, unknown>, apiKey: string): boolean {
  const meta = call.metadata.get('x-api-key');
  return meta.length > 0 && meta[0] === apiKey;
}

export function buildGithubGrpcServer(deps: GithubGrpcDeps): grpc.Server {
  const server = new grpc.Server();

  const impl: GitHubServiceServer = {
    verifyRepo: async (call, callback) => {
      if (!checkApiKey(call, deps.apiKey)) {
        callback({
          code: grpc.status.UNAUTHENTICATED,
          message: 'Unauthorized: Invalid or missing API key',
        });
        return;
      }
      try {
        const { owner, name } = call.request;
        const repo = await deps.service.verifyRepo(owner, name);
        callback(null, repoToProto(repo));
      } catch (err) {
        handleError(err, callback, deps.logger);
      }
    },
    getLatestRelease: async (call, callback) => {
      if (!checkApiKey(call, deps.apiKey)) {
        callback({
          code: grpc.status.UNAUTHENTICATED,
          message: 'Unauthorized: Invalid or missing API key',
        });
        return;
      }
      try {
        const { owner, name, bypassCache } = call.request;
        const release = await deps.service.getLatestRelease(owner, name, bypassCache);
        callback(null, releaseToProto(release));
      } catch (err) {
        handleError(err, callback, deps.logger);
      }
    },
  };

  server.addService(
    GitHubServiceService as any,
    impl as grpc.UntypedServiceImplementation,
  );
  return server;
}

export function startGrpcServer(
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
      logger.info({ port }, 'github-service gRPC listening');
      resolve();
    });
  });
}
