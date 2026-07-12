# ADR 007: Use tsyringe for Dependency Injection

**Status**: Accepted
**Date**: 2026-06-11

## Context

HW6 required each feature module to expose a real public API with a stable contract, and to replace the hand-wired composition root (`build-graph.ts`) with something that enforced that boundary. The codebase already used constructor injection throughout, but all wiring was manual — every class was instantiated and threaded by hand, which made the "public vs internal" distinction implicit and easy to violate.

The goal was:
- a DI container that treats an interface token as the public contract of a module;
- concrete classes stay internal and are never imported directly across module boundaries;
- each module self-registers via a `registerXModule(container)` function.

## Decision

Adopt **tsyringe** as the DI container.

Each feature module exposes exactly three public artefacts: a `Symbol` token, a TypeScript interface, and a `registerXModule(container)` factory registration. Concrete classes are internal. Singletons that are shared across modules (event bus, metrics) are registered with `instanceCachingFactory` to guarantee one instance per container. The old `build-graph.ts` was replaced by `src/composition/container.ts` (`buildContainer`).

## Alternatives Considered

| Option | Reason rejected |
|--------|----------------|
| InversifyJS | Heavier API surface; `ContainerModule` per feature adds ceremony without benefit at this scale. |
| Awilix | No decorator/reflect-metadata model; proxy/classic injection is less idiomatic for Symbol-keyed interface tokens. |
| Keep manual wiring | Works but enforces no public-API boundary — any class can be imported anywhere; the constraint lives only in convention. |

## Rationale

tsyringe's decorator + token model maps directly onto the "token = public contract" pattern. A consuming module resolves by token (`container.resolve<IFoo>(FOO_TOKEN)`) and never sees the concrete class. The library is lightweight (no mandatory base classes or container hierarchies), and `instanceCachingFactory` provides the per-container singleton behaviour required for stateful shared dependencies.

## Consequences

- `reflect-metadata` must be imported once at the process entry point; `tsconfig.json` requires `experimentalDecorators: true` and `emitDecoratorMetadata: true`.
- **Critical**: a plain `useFactory` runs on every `resolve` call. Stateful shared singletons (event bus, metrics registry) **must** be registered with `instanceCachingFactory`. Using a plain factory caused a real bug where the event bus publisher and subscriber received different instances — events were silently lost and confirmation emails were never enqueued. The fix was switching to `instanceCachingFactory`.
- Classes registered via factory keep ordinary constructors (no decorators needed), which kept existing unit tests green without modification.
- DI tokens live in `src/composition/tokens.ts`, which is the one file that `composition/` imports from modules — all other cross-module dependencies flow through the container.
