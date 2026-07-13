import Fastify from 'fastify';

interface CapturedEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
}

const emails: CapturedEmail[] = [];
const port = Number(process.env.MOCK_PORT) || 4000;
const app = Fastify({ logger: false });

function repoBody(owner: string, name: string) {
  return {
    id: `${owner}/${name}`.length,
    full_name: `${owner}/${name}`,
    name,
    owner: { login: owner },
    description: `Mock repository ${owner}/${name}`,
    html_url: `https://github.com/${owner}/${name}`,
    private: false,
  };
}

app.get('/health', async () => ({ ok: true }));

app.post('/emails', async (request, reply) => {
  emails.push(request.body as CapturedEmail);
  return reply.status(202).send({ ok: true });
});

app.get('/emails', async () => ({ emails }));

app.post('/emails/reset', async () => {
  emails.length = 0;
  return { ok: true };
});

app.post('/github/__admin/reset', async () => ({ ok: true }));

app.get('/github/internal/repos/:owner/:name', async (request, reply) => {
  const { owner, name } = request.params as { owner: string; name: string };

  if (owner === 'missing' && name === 'repo') {
    return reply.status(404).send({ message: 'Not Found' });
  }

  if (owner === 'rate' && name === 'limited') {
    return reply.status(429).send({ message: 'API rate limit exceeded' });
  }

  return reply.send(repoBody(owner, name));
});

app.get('/github/internal/repos/:owner/:name/latest-release', async (request, reply) => {
  const { owner, name } = request.params as { owner: string; name: string };

  if (owner === 'no' && name === 'release') {
    return reply.send({ found: false, release: null });
  }

  return reply.send({
    found: true,
    release: {
      id: 1,
      tag_name: 'v1.0.0',
      name: 'v1.0.0',
      body: 'Mock release',
      html_url: `https://github.com/${owner}/${name}/releases/tag/v1.0.0`,
      published_at: '2026-01-01T00:00:00Z',
      draft: false,
      prerelease: false,
    },
  });
});

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
