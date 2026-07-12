const { spawnSync } = require('node:child_process');

const suite = process.argv[2];
const suites = new Set(['unit', 'integration', 'e2e']);

if (!suites.has(suite)) {
  console.error('Usage: node scripts/run-docker-tests.js <unit|integration|e2e>');
  process.exit(1);
}

const compose = ['compose', '-f', 'docker-compose.test.yml', '-p', `github-subscriptions-${suite}`];
const env = { ...process.env, TEST_SUITE: suite };
const shell = process.platform === 'win32';

function run(args, options = {}) {
  const result = spawnSync('docker', args, {
    stdio: 'inherit',
    shell,
    env,
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function cleanup() {
  run([...compose, 'down', '-v', '--remove-orphans'], { stdio: 'ignore' });
}

cleanup();

let exitCode = 1;
try {
  if (suite === 'unit') {
    exitCode = run([...compose, 'build', 'unit-test-runner']);
    if (exitCode === 0) {
      exitCode = run([...compose, 'run', '--rm', 'unit-test-runner']);
    }
  } else {
    exitCode = run([
      ...compose,
      'up',
      '--build',
      '--abort-on-container-exit',
      '--exit-code-from',
      'api-test-runner',
      'api-test-runner',
    ]);
  }
} finally {
  cleanup();
}

process.exit(exitCode);
