/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-deep-import',
      severity: 'error',
      comment:
        'A module may import another module only via its index.ts or *.module.ts public API. ' +
        'Deep imports into other module internals are forbidden.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: [
          // Same module — allow (back-reference $1 matches the capturing group from `from.path`)
          '^src/modules/$1/',
          // Any module's barrel index — allow
          '^src/modules/[^/]+/index\\.ts$',
          // Any module's named public API file — allow
          '^src/modules/[^/]+/[^/]+\\.module\\.ts$',
        ],
      },
    },
    {
      name: 'modules-no-composition',
      severity: 'error',
      comment:
        'Feature modules must not import composition roots or services. ' +
        'Exception: composition/tokens.ts (DI injection symbols) is allowed — it is ' +
        'effectively a shared-constants file and was never flagged by the old boundary script.',
      from: { path: '^src/modules/' },
      to: {
        path: '^src/(composition|services)/',
        pathNot: [
          // Injection token symbols — allowed for modules to reference
          '^src/composition/tokens\\.ts$',
        ],
      },
    },
    {
      name: 'shared-is-leaf',
      severity: 'error',
      comment: 'shared/** is cross-cutting and must not depend on feature modules.',
      from: { path: '^src/shared/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'services-isolated',
      severity: 'error',
      comment:
        'Feature modules and shared code must not import the extracted services internals; cross only over the wire.',
      from: { path: '^src/(modules|shared)/' },
      to: { path: '^src/services/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No circular dependencies.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)index\\.ts$'],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '(\\.test\\.ts$|\\.spec\\.ts$|__tests__|/public/)' },
  },
};
