export const confirmationSchema = {
  body: {
    type: 'object',
    required: ['email', 'confirmToken', 'repo'],
    properties: {
      email: { type: 'string' },
      confirmToken: { type: 'string' },
      repo: { type: 'string' },
    },
  },
} as const;

export const releaseSchema = {
  body: {
    type: 'object',
    required: ['email', 'unsubscribeToken', 'repo', 'release'],
    properties: {
      email: { type: 'string' },
      unsubscribeToken: { type: 'string' },
      repo: { type: 'string' },
      release: {
        type: 'object',
        required: ['tagName', 'name', 'htmlUrl', 'publishedAt'],
        properties: {
          tagName: { type: 'string' },
          name: { type: 'string' },
          htmlUrl: { type: 'string' },
          publishedAt: { type: 'string' },
        },
      },
    },
  },
} as const;
