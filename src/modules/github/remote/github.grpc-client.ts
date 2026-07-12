import * as grpc from '@grpc/grpc-js';
import { GitHubServiceClient } from '@/generated/proto/github';
import type { IGitHubService } from '../github.module';
import type { GitHubRelease, GitHubRepo } from '../github.types';
import { AppError, NotFoundError, RateLimitError } from '@/shared/errors/app-error';
import type { ILogger } from '@/shared/logger';

export interface GitHubGrpcClientConfig {
  address: string;
  apiKey: string;
  logger: ILogger;
}

function mapGrpcError(err: grpc.ServiceError): AppError {
  switch (err.code) {
    case grpc.status.NOT_FOUND:
      return new NotFoundError(err.message);
    case grpc.status.RESOURCE_EXHAUSTED:
      return new RateLimitError(0);
    case grpc.status.UNAUTHENTICATED:
      return new AppError(err.message, 401);
    case grpc.status.ALREADY_EXISTS:
      return new AppError(err.message, 409);
    case grpc.status.INVALID_ARGUMENT:
      return new AppError(err.message, 400);
    default:
      return new AppError(err.message, 500);
  }
}

export class GitHubGrpcClient implements IGitHubService {
  private readonly client: GitHubServiceClient;
  private readonly metadata: grpc.Metadata;
  private readonly logger: ILogger;

  constructor(config: GitHubGrpcClientConfig) {
    this.client = new GitHubServiceClient(
      config.address,
      grpc.credentials.createInsecure(),
    );
    this.metadata = new grpc.Metadata();
    this.metadata.set('x-api-key', config.apiKey);
    this.logger = config.logger;
  }

  verifyRepo(owner: string, name: string): Promise<GitHubRepo> {
    return new Promise((resolve, reject) => {
      this.client.verifyRepo({ owner, name }, this.metadata, (err, response) => {
        if (err) { reject(mapGrpcError(err)); return; }
        resolve({
          id: response.id,
          full_name: response.fullName,
          name: response.name,
          owner: { login: response.ownerLogin },
          description: response.description || null,
          html_url: response.htmlUrl,
          private: response.private,
        });
      });
    });
  }

  getLatestRelease(owner: string, name: string, bypassCache = false): Promise<GitHubRelease | null> {
    return new Promise((resolve, reject) => {
      this.client.getLatestRelease({ owner, name, bypassCache }, this.metadata, (err, response) => {
        if (err) { reject(mapGrpcError(err)); return; }
        if (!response.found || !response.release) { resolve(null); return; }
        const r = response.release;
        resolve({
          id: r.id,
          tag_name: r.tagName,
          name: r.name || null,
          body: r.body || null,
          html_url: r.htmlUrl,
          published_at: r.publishedAt || null,
          draft: r.draft,
          prerelease: r.prerelease,
        });
      });
    });
  }
}
