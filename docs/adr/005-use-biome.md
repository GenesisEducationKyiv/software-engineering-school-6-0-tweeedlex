# ADR 005: Use Biome as Linter and Formatter

**Status**: Accepted  
**Date**: 2026-05-03

## Context

The project needs a linter and formatter for TypeScript. The main contenders considered were:

| Tool | Role | Language |
|---|---|---|
| ESLint + Prettier | Lint + Format | JS (config in JS/JSON) |
| oxlint | Lint only | Rust |
| dprint | Format only | Rust/WASM |
| Biome | Lint + Format | Rust |

## Decision

Use **Biome v1.9**.

## Rationale

### Single tool, single config

ESLint handles only linting; Prettier handles only formatting. Running both means two separate processes, two config files, and a shared plugin (`eslint-config-prettier`) to prevent rule conflicts. Biome replaces both with one binary and one `biome.json`.

### Performance

Biome is written in Rust and processes files in parallel. On a cold run it is roughly 15–25× faster than ESLint + Prettier on the same codebase. For a small service this matters less at runtime, but it makes pre-commit hooks and CI feedback instant rather than slow.

### oxlint comparison

oxlint is also Rust-based and fast, but it is a linter only - a formatter still needs to be added separately (typically dprint or Prettier). Biome covers both, and its rule set is large enough (~300 rules) to match the recommended ESLint + TypeScript-ESLint baseline without plugins.

oxlint is a good choice when migrating a large existing ESLint config incrementally, since it is intentionally ESLint-compatible. For a greenfield TypeScript project Biome's integrated toolchain is simpler.

### ESLint comparison

ESLint has the largest rule ecosystem and is the de-facto standard. The drawbacks for this project:

- Requires separate `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` setup.
- Prettier must be added separately and kept in sync via `eslint-config-prettier`.
- Cold lint + format runs are noticeably slower, which hurts pre-commit and watch-mode feedback loops.
- Config (flat config or legacy `.eslintrc`) is more verbose than `biome.json`.

For a project that needs hundreds of custom or community ESLint rules, ESLint remains the right choice. This service does not.

### Import organization

Biome's `organizeImports` sorts and deduplicates imports on format. ESLint can do this via `eslint-plugin-import` or `eslint-plugin-simple-import-sort`, but requires additional config. Biome does it out of the box.

### VCS integration

The `vcs.useIgnoreFile` flag makes Biome respect `.gitignore` automatically, avoiding duplicate ignore lists.

## Consequences

- Developers need `biome` in `devDependencies` - no global installs required; `npx biome` works.
- IDE support: the official VS Code extension (`biomejs.biome`) provides real-time diagnostics and format-on-save.
- Rules that exist in ESLint but not yet in Biome are unavailable. Biome's rule coverage is growing; for this project no gaps were identified that warranted keeping ESLint.
