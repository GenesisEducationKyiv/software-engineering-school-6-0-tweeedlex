export const confirmationPayload = {
  email: 'bench@example.com',
  confirmToken: 'tok-bench',
  repo: 'octocat/hello-world',
};

export const releasePayload = {
  email: 'bench@example.com',
  unsubscribeToken: 'unsub-bench',
  repo: 'octocat/hello-world',
  release: {
    tagName: 'v1.2.3',
    name: 'Release v1.2.3 — a longer release name to grow the payload a bit for the comparison',
    htmlUrl: 'https://github.com/octocat/hello-world/releases/tag/v1.2.3',
    publishedAt: '2026-06-11T00:00:00.000Z',
  },
};
