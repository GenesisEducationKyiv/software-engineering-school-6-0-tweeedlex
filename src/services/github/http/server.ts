import type { IGitHubService } from '@/modules/github';
import { AppError } from '@/shared/errors/app-error';
import type { ILogger } from '@/shared/logger';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

export interface GithubHttpDeps {
  service: IGitHubService;
  apiKey: string;
  logger: ILogger;
}

function requireApiKey(apiKey: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const provided = req.headers['x-api-key'];
    if (provided !== apiKey) {
      await reply.code(401).send({ message: 'Unauthorized: Invalid or missing API key' });
    }
  };
}

function sendError(err: unknown, reply: FastifyReply, logger: ILogger): void {
  if (err instanceof AppError) {
    void reply.code(err.statusCode).send({ message: err.message });
    return;
  }
  logger.error({ err }, 'Unexpected github-service HTTP error');
  void reply.code(500).send({ message: 'Internal server error' });
}

export async function buildGithubHttpServer(deps: GithubHttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const guard = requireApiKey(deps.apiKey);

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get<{ Params: { owner: string; name: string } }>(
    '/internal/repos/:owner/:name',
    { preHandler: guard },
    async (req, reply) => {
      try {
        const { owner, name } = req.params;
        const repo = await deps.service.verifyRepo(owner, name);
        return reply.send(repo);
      } catch (err) {
        sendError(err, reply, deps.logger);
      }
    },
  );

  app.get<{ Params: { owner: string; name: string }; Querystring: { bypassCache?: string } }>(
    '/internal/repos/:owner/:name/latest-release',
    { preHandler: guard },
    async (req, reply) => {
      try {
        const { owner, name } = req.params;
        const bypass = req.query.bypassCache === 'true';
        const release = await deps.service.getLatestRelease(owner, name, bypass);
        return reply.send({ found: release !== null, release });
      } catch (err) {
        sendError(err, reply, deps.logger);
      }
    },
  );

  return app;
}
