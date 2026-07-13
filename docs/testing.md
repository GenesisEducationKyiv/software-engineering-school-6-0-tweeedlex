# Testing

The test commands run in Docker with clean containers and volumes. A fresh machine only needs Git, Docker, and Node.js/npm.

| Test type | Command |
| --- | --- |
| Unit | `npm run test:unit` |
| Integration | `npm run test:integration` |
| E2E | `npm run test:e2e` |

Integration and E2E tests start Postgres, Redis, the app, a mock GitHub API, and a mock email service from scratch. They do not call real GitHub or Resend.
