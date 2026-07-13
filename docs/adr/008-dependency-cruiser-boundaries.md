# ADR 008: Enforce Module Boundaries with dependency-cruiser

**Status**: Accepted
**Date**: 2026-06-11

## Context

HW3 introduced a custom script (`scripts/check-module-boundaries.ts`) that enforced barrel-only cross-module imports: feature modules were only allowed to import from each other's `index.ts`, never from internal paths. The script worked but was hand-maintained, had no cycle detection, produced no visual output, and would drift as the module structure evolved.

HW6 introduced tsyringe and a `composition/` layer, requiring updated boundary rules, which made the limitations of a bespoke script more acute.

## Decision

Replace the custom script with **dependency-cruiser** (config: `.dependency-cruiser.cjs`), wired into `npm run lint` as the `lint:boundaries` script.

The following rules are declared:

| Rule | What it enforces |
|------|-----------------|
| `no-cross-module-deep-import` | Modules import each other only via `index.ts` or `*.module.ts`; no reaching into internal paths. |
| `modules-no-composition` | Feature modules do not import from `composition/` — with one documented exception for `composition/tokens.ts` (DI tokens are a shared contract, not implementation). |
| `shared-is-leaf` | `shared/` utilities do not import from feature modules. |
| `no-circular` | No circular dependency chains anywhere in `src/`. |
| `no-orphans` | Files with no importers emit a warning (catches dead code). |

The `boundaries:graph` script generates `docs/architecture/deps.dot` (a Graphviz dot file) which doubles as the architecture boundaries diagram deliverable.

## Alternatives Considered

| Option | Reason rejected |
|--------|----------------|
| `eslint-plugin-boundaries` | Requires running ESLint alongside Biome — two linters in the same project. Rejected to keep the toolchain coherent. |
| Nx / Turborepo boundary tags | Monorepo-scale tooling; introduces a build graph orchestrator for a single service. Overkill. |
| Keep the custom script | No cycle detection, no graph output, no rule declarations — only import-path pattern matching. Unmaintained as structure evolves. |

## Rationale

dependency-cruiser is lint-agnostic (integrates with any formatter/linter), declarative, detects cycles and orphans, and generates visual output. Running it as `npm run lint:boundaries` integrates with the existing `npm run lint` step and therefore CI, with no special runner required.

## Consequences

- `scripts/check-module-boundaries.ts` was deleted.
- Boundary checks run in CI as part of `npm run lint`.
- `.gitattributes` was added (enforcing `eol=lf`) so that Biome's LF line-ending check stays green across Windows and Linux environments.
- The `deps.dot` graph is regenerated manually (`npm run boundaries:graph`) and committed when the module structure changes.
