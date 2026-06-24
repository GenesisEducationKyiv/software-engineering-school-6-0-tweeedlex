/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.integration.test.ts'],
  // All suites share one database, Redis instance and mock server, so they
  // must run serially — parallel workers would clobber each other's state.
  // Enforced here (not just via --runInBand) so the flag can't be dropped by
  // accident.
  maxWorkers: 1,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
