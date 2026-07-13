# ADR 002: Modular Monolith over Clean Architecture

**Status**: Accepted  
**Date**: 2026-04-10

## Context

The service is a single-purpose API: subscribe users to GitHub release notifications and deliver them via email. The scope is narrow — 4 HTTP endpoints, a background scanner, and an email worker.

Two structural approaches were considered:

1. **Clean Architecture** (ports & adapters, use cases, domain layer)
2. **Modular monolith** (feature modules, direct dependencies, no abstraction layers beyond what's needed)

## Decision

Use a **modular monolith**: code is grouped by feature module (`github`, `subscriptions`, `scanner`, `notifications`) with a thin infrastructure layer (`db`, `redis`, `queue`). Modules depend directly on each other via constructor injection. No use-case classes, no port interfaces, no domain layer.

## Rationale

Clean Architecture would require: domain entities, use-case classes, port interfaces for every external dependency, and adapter implementations for each. For a service of this size that translates to 3–4x more files with most of them being single-method wrappers — boilerplate without benefit.

The modular monolith provides the same key properties at a fraction of the overhead:

- **Separation of concerns**: each module owns its own types, service, and routes
- **Testability**: constructor injection makes mocking straightforward without interface indirection
- **Replaceability**: swapping e.g. the email provider means changing one file (`ResendEmailProvider`), not touching a port/adapter boundary

The service has no complex domain logic that would benefit from a rich domain model. Business rules are simple enough to live in service classes directly.

## Consequences

- Adding a second bounded context (e.g. billing) would require extracting shared infrastructure — acceptable risk given the single-purpose scope.
- No repository interfaces means tests mock concrete classes, which is slightly brittle but avoids ceremony for a service unlikely to swap its database.
