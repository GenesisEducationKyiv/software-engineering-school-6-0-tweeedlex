import type { FastifySchema } from 'fastify';

export const subscribeSchema: FastifySchema = {
  summary: 'Subscribe to release notifications',
  description:
    'Subscribe an email to receive notifications about new releases of a GitHub repository. The repository is validated via GitHub API.',
  tags: ['subscription'],
  security: [{ apiKey: [] }],
  body: {
    type: 'object',
    required: ['email', 'repo'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'Email address to subscribe',
        examples: ['test@example.com'],
      },
      repo: {
        type: 'string',
        pattern: '^[^/ ]+/[^/ ]+$',
        description: 'GitHub repository in owner/repo format (e.g., golang/go)',
        examples: ['golang/go'],
      },
    },
  },
  response: {
    200: { description: 'Subscription successful. Confirmation email sent.', type: 'null' },
    400: { description: 'Invalid input (e.g., invalid repo format)', type: 'null' },
    404: { description: 'Repository not found on GitHub', type: 'null' },
    409: { description: 'Email already subscribed to this repository', type: 'null' },
  },
};

export const confirmSchema: FastifySchema = {
  summary: 'Confirm email subscription',
  description: 'Confirms a subscription using the token sent in the confirmation email.',
  tags: ['subscription'],
  params: {
    type: 'object',
    required: ['token'],
    properties: {
      token: {
        type: 'string',
        pattern: '^[A-Za-z0-9_-]{43}$',
        description: 'Confirmation token (base64url, 43 characters)',
      },
    },
  },
  response: {
    200: { description: 'Subscription confirmed successfully', type: 'null' },
    400: { description: 'Invalid token format', type: 'null' },
    404: { description: 'Token not found', type: 'null' },
  },
};

export const unsubscribeSchema: FastifySchema = {
  summary: 'Unsubscribe from release notifications',
  description: 'Unsubscribes an email from release notifications using the token sent in emails.',
  tags: ['subscription'],
  params: {
    type: 'object',
    required: ['token'],
    properties: {
      token: {
        type: 'string',
        pattern: '^[A-Za-z0-9_-]{43}$',
        description: 'Unsubscribe token (base64url, 43 characters)',
      },
    },
  },
  response: {
    200: { description: 'Unsubscribed successfully', type: 'null' },
    400: { description: 'Invalid token format', type: 'null' },
    404: { description: 'Token not found', type: 'null' },
  },
};

export const subscriptionsSchema: FastifySchema = {
  summary: 'Get subscriptions for an email',
  description: 'Returns all active subscriptions for the given email address.',
  tags: ['subscription'],
  security: [{ apiKey: [] }],
  querystring: {
    type: 'object',
    required: ['email'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'Email address to look up subscriptions for',
        examples: ['test@example.com'],
      },
    },
  },
  response: {
    200: {
      description: 'Successful operation - list of subscriptions returned',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          email: { type: 'string', examples: ['test@example.com'] },
          repo: { type: 'string', examples: ['golang/go'] },
          confirmed: { type: 'boolean', examples: [true] },
          last_seen_tag: { type: 'string', examples: ['v1.22.0'] },
        },
      },
    },
    400: { description: 'Invalid email', type: 'null' },
  },
};
