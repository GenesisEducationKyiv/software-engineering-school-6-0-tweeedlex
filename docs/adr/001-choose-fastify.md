# ADR 001: Use Fastify as the HTTP Framework

**Status**: Accepted  
**Date**: 2026-04-10

## Context

The task requires an HTTP API in Node.js. The allowed frameworks are Fastify or Express. NestJS is explicitly prohibited.

The service has a simple API surface (4 endpoints) but must handle concurrent background scanning and email jobs efficiently. Low overhead at the HTTP layer frees up resources for background work.

## Decision

Use **Fastify v4**.

## Rationale

- **Faster than Express**: Fastify benchmarks at ~2–3x higher throughput due to its schema-based serialization with `fast-json-stringify` and optimized routing.
- **JSON schema validation built-in**: Request bodies, query params, and route params are validated via Ajv without extra middleware. This covers the swagger contract's input constraints (email format, required fields) at the framework layer.
- **Plugin system**: First-class support for encapsulated plugins (`fastify-plugin`) allows clean module registration with dependency injection via plugin options.
- **TypeScript support**: Generics on `fastify.get<{ Querystring: ... }>()` give typed `request.query` without runtime overhead.
- **`pino` is the default logger**: No glue code needed.

## Consequences

- Route handlers use Fastify's generic typing syntax — slightly more verbose than Express but ensures compile-time safety.
- Fastify's encapsulation model requires `fastify-plugin` to share state (like services) across plugins; this is a known pattern and well-documented.
- `@fastify/static` serves the HTML subscribe page without a separate web server.
