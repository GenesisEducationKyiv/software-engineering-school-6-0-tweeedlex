# Modular / Microservices Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual DI + custom boundary script with a tsyringe DI container and dependency-cruiser, then extract the notification module into a separate process exposing HTTP + gRPC APIs, and benchmark the two transports.

**Architecture:** Phases are sequential and each leaves the build green. Phase 1 (DI) and Phase 2 (boundaries) keep the single process behaving identically. Phase 3 stands up the notification service standalone. Phase 4 rewires the monolith to call it over HTTP/gRPC. Phase 5 benchmarks. Phase 6 documents.

**Tech Stack:** Node 20, TypeScript (CommonJS, ES2022), Fastify, `@grpc/grpc-js` + `@grpc/proto-loader`, BullMQ + Redis, Prisma, tsyringe + reflect-metadata, dependency-cruiser, autocannon, Jest.

**Spec:** `docs/superpowers/specs/2026-06-11-modular-microservices-refactor-design.md`

**Conventions for the worker:**
- Tests run in Docker: `npm run test:unit` (full) — slow. For a single file during dev use the container script the repo already wires, or run `npx jest --config jest.unit.config.js <path>` inside the test container. Each task states the command.
- `@/` path alias maps to `src/`.
- Commit after each task. Use the messages given.
- Do NOT skip the "run test, verify it fails" steps.

---

## Phase 0: Branch check

- [ ] **Step 1: Confirm branch + clean tree**

Run: `git status --short --branch`
Expected: on `hw-6-monolith-microservices`, no unexpected staged changes (the committed spec is fine).

---

## Phase 1: tsyringe DI container + public module APIs

Goal: every module exposes `token + interface + register*`; `build-graph.ts` becomes a container builder. Behavior identical, one process.

### Task 1.1: Install tsyringe + enable decorators

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `tsconfig.json:2-21` (compilerOptions)

- [ ] **Step 1: Install deps**

Run: `npm install tsyringe reflect-metadata`
Expected: both added to `dependencies`.

- [ ] **Step 2: Enable decorator metadata in tsconfig**

Edit `tsconfig.json` `compilerOptions`, add:

```json
"experimentalDecorators": true,
"emitDecoratorMetadata": true,
"useDefineForClassFields": false,
```

- [ ] **Step 3: Verify build still compiles**

Run: `npm run build`
Expected: exits 0, `dist/` produced.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore(di): add tsyringe + reflect-metadata, enable decorator metadata"
```

### Task 1.2: Define shared DI tokens

**Files:**
- Create: `src/composition/tokens.ts`

- [ ] **Step 1: Create tokens file**

```ts
import type { InjectionToken } from 'tsyringe';
import type { Config } from '@/config/env';
import type { ILogger } from '@/shared/logger';

// Root inputs
export const CONFIG: InjectionToken<Config> = Symbol('CONFIG');
export const ROOT_LOGGER: InjectionToken<ILogger> = Symbol('ROOT_LOGGER');
```

Module-specific tokens live in each module's `*.module.ts` (defined in later tasks), not here.

- [ ] **Step 2: Compile check**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/composition/tokens.ts
git commit -m "feat(di): add root DI tokens (CONFIG, ROOT_LOGGER)"
```

### Task 1.3: Infra module registration

**Files:**
- Create: `src/infrastructure/infra.module.ts`
- Test: `src/infrastructure/__tests__/infra.module.test.ts`

Infra owns prisma, redis, bullmq, metrics, event bus. These are created from `CONFIG` + `ROOT_LOGGER` via factory registrations. Tokens are exported here because multiple modules consume them.

- [ ] **Step 1: Write the failing test**

```ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { PinoLogger } from '@/shared/logger';
import { EVENT_BUS, METRICS, registerInfraModule } from '@/infrastructure/infra.module';
import { InProcessEventBus } from '@/shared/events';
import { PrometheusMetricsCollector } from '@/shared/metrics';

describe('registerInfraModule', () => {
  it('registers event bus and metrics resolvable from the container', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, { redisUrl: 'redis://localhost:6379' } as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent' }));
    registerInfraModule(c);
    expect(c.resolve(EVENT_BUS)).toBeInstanceOf(InProcessEventBus);
    expect(c.resolve(METRICS)).toBeInstanceOf(PrometheusMetricsCollector);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest --config jest.unit.config.js src/infrastructure/__tests__/infra.module.test.ts`
Expected: FAIL — `infra.module` has no export `EVENT_BUS`.

- [ ] **Step 3: Implement infra.module.ts**

```ts
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import type { Config } from '@/config/env';
import { createPrismaClient } from '@/infrastructure/db/prisma-factory';
import { createRedisClient, type RedisClient } from '@/infrastructure/redis/redis-factory';
import type { ILogger } from '@/shared/logger';
import { InProcessEventBus, type IEventBus } from '@/shared/events';
import { METRIC_DEFINITIONS, PrometheusMetricsCollector } from '@/shared/metrics';
import type { IMetricsCollector } from '@/shared/metrics';
import { BullMQConnection } from '@/shared/queue';
import type { PrismaClient } from '@prisma/client';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';

export const PRISMA: InjectionToken<PrismaClient> = Symbol('PRISMA');
export const REDIS: InjectionToken<RedisClient> = Symbol('REDIS');
export const BULLMQ: InjectionToken<BullMQConnection> = Symbol('BULLMQ');
export const METRICS: InjectionToken<IMetricsCollector> = Symbol('METRICS');
export const EVENT_BUS: InjectionToken<IEventBus> = Symbol('EVENT_BUS');

export function registerInfraModule(c: DependencyContainer): void {
  c.register(METRICS, {
    useFactory: () =>
      new PrometheusMetricsCollector(METRIC_DEFINITIONS, {
        defaultMetricsPrefix: 'github_notifier_',
      }),
  });
  c.register(EVENT_BUS, {
    useFactory: (dep) => {
      const logger = dep.resolve<ILogger>(ROOT_LOGGER);
      return new InProcessEventBus(logger.child({ component: 'event-bus' }));
    },
  });
  // Singleton instances created eagerly for async/connection resources are
  // registered by the composition root after async init (see Task 1.8).
}

// Async resources (prisma, redis, bullmq) need connection; created in the
// composition root and registered as instances.
export async function createInfraInstances(config: Config, logger: ILogger) {
  const prisma = createPrismaClient(
    config.databaseUrl,
    config.nodeEnv,
    logger.child({ component: 'prisma' }),
  );
  const redis = await createRedisClient(config.redisUrl, logger.child({ component: 'redis' }));
  const bullmq = new BullMQConnection(config.redisUrl, logger.child({ component: 'bullmq' }));
  return { prisma, redis, bullmq };
}
```

Note: tsyringe `useFactory` receives the container as its argument; resolve dependencies from it.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx jest --config jest.unit.config.js src/infrastructure/__tests__/infra.module.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/infra.module.ts src/infrastructure/__tests__/infra.module.test.ts
git commit -m "feat(di): infra module registration (metrics, event bus, async factory)"
```

### Task 1.4: github module public API

**Files:**
- Modify: `src/modules/github/github.service.ts` (add `@injectable`, `@inject`, implement interface)
- Modify: `src/modules/github/github.client.ts` (add `@injectable` + token injection)
- Modify: `src/modules/github/github.cache.ts` (add `@injectable` + token injection)
- Create: `src/modules/github/github.module.ts`
- Modify: `src/modules/github/index.ts` (re-export from module file, keep type exports)
- Test: `src/modules/github/__tests__/github.module.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { GITHUB_SERVICE, registerGithubModule } from '@/modules/github/github.module';
import { GitHubService } from '@/modules/github/github.service';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { METRICS, REDIS, registerInfraModule } from '@/infrastructure/infra.module';
import { PinoLogger } from '@/shared/logger';

describe('registerGithubModule', () => {
  it('resolves IGitHubService to a GitHubService instance', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, {
      githubToken: undefined,
      githubApiBaseUrl: 'https://api.github.com',
      githubCacheTtlSeconds: 600,
    } as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent' }));
    c.registerInstance(REDIS, { get: async () => null, set: async () => 'OK' } as never);
    registerInfraModule(c);
    registerGithubModule(c);
    expect(c.resolve(GITHUB_SERVICE)).toBeInstanceOf(GitHubService);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest --config jest.unit.config.js src/modules/github/__tests__/github.module.test.ts`
Expected: FAIL — no `github.module` export.

- [ ] **Step 3: Make the classes injectable**

In `github.client.ts`, `github.cache.ts`, `github.service.ts`: add `import 'reflect-metadata'` is NOT needed per-file (done at entrypoint), but decorate. Example for `github.service.ts` — wrap the class:

```ts
import { inject, injectable } from 'tsyringe';
import { GITHUB_CACHE, GITHUB_CLIENT } from './github.module';
import type { IGitHubClient } from './github.client';
import type { IGitHubCache } from './github.cache';
// ... existing imports

@injectable()
export class GitHubService {
  constructor(
    @inject(GITHUB_CLIENT) private readonly client: IGitHubClient,
    @inject(GITHUB_CACHE) private readonly cache: IGitHubCache,
  ) {}
  // ... existing methods unchanged
}
```

Apply the same pattern to `GitHubClient` (inject `CONFIG`, `ROOT_LOGGER` child, `METRICS`) and `GitHubCache` (inject `REDIS`, `CONFIG` for ttl, `ROOT_LOGGER` child). Where a constructor needs a *child* logger or a config field, inject the base token and derive inside, OR register a value token. Keep existing constructor param names/types; only the source of the value changes to `@inject`.

> If a class currently takes a primitive (e.g. `ttlSeconds: number`), register a value token for it in `registerGithubModule` rather than threading `CONFIG` everywhere. Simplest: inject `CONFIG` and read the field in the constructor body, assigning to a private field.

- [ ] **Step 4: Create github.module.ts**

```ts
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import type { GitHubRelease, GitHubRepo } from './github.types';
import { GitHubCache } from './github.cache';
import { GitHubClient } from './github.client';
import { GitHubService } from './github.service';

export interface IGitHubService {
  verifyRepo(owner: string, name: string): Promise<GitHubRepo>;
  getLatestRelease(owner: string, name: string, bypassCache?: boolean): Promise<GitHubRelease | null>;
}

export const GITHUB_CLIENT: InjectionToken = Symbol('GITHUB_CLIENT');
export const GITHUB_CACHE: InjectionToken = Symbol('GITHUB_CACHE');
export const GITHUB_SERVICE: InjectionToken<IGitHubService> = Symbol('GITHUB_SERVICE');

export type { GitHubRepo, GitHubRelease } from './github.types';

export function registerGithubModule(c: DependencyContainer): void {
  c.register(GITHUB_CLIENT, { useClass: GitHubClient });
  c.register(GITHUB_CACHE, { useClass: GitHubCache });
  c.register(GITHUB_SERVICE, { useClass: GitHubService });
}
```

Add `IGitHubClient` / `IGitHubCache` interfaces in their respective files (extract the public method signatures the service uses) so the service can depend on interfaces, not classes.

- [ ] **Step 5: Update index.ts**

```ts
export {
  GITHUB_SERVICE,
  registerGithubModule,
  type IGitHubService,
  type GitHubRepo,
  type GitHubRelease,
} from './github.module';
```

Remove the old concrete-class exports (`GitHubService`, `GitHubClient`, `GitHubCache`) — they are now internal.

- [ ] **Step 6: Run test, verify it passes**

Run: `npx jest --config jest.unit.config.js src/modules/github/__tests__/github.module.test.ts`
Expected: PASS.

- [ ] **Step 7: Run existing github tests**

Run: `npx jest --config jest.unit.config.js src/modules/github`
Expected: PASS (existing service/cache/client tests still green; update their construction to use `new` directly — those are unit tests of the class internals, allowed to import the concrete class via relative path).

- [ ] **Step 8: Commit**

```bash
git add src/modules/github
git commit -m "feat(di): github module public API (token + IGitHubService), injectable classes"
```

### Task 1.5: subscriptions module public API

**Files:**
- Modify: `subscription.service.ts`, `subscription.repository.ts`, `repo.repository.ts`, `subscription.validator.ts` (add `@injectable`/`@inject`)
- Create: `src/modules/subscriptions/subscriptions.module.ts`
- Modify: `src/modules/subscriptions/index.ts`
- Test: `src/modules/subscriptions/__tests__/subscriptions.module.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { SUBSCRIPTION_SERVICE, registerSubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { SubscriptionService } from '@/modules/subscriptions/subscription.service';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { EVENT_BUS, METRICS, PRISMA, REDIS, registerInfraModule } from '@/infrastructure/infra.module';
import { GITHUB_SERVICE } from '@/modules/github';
import { PinoLogger } from '@/shared/logger';

describe('registerSubscriptionsModule', () => {
  it('resolves SUBSCRIPTION_SERVICE', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, {} as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent' }));
    c.registerInstance(PRISMA, {} as never);
    c.registerInstance(GITHUB_SERVICE, { verifyRepo: async () => ({}) } as never);
    registerInfraModule(c);
    registerSubscriptionsModule(c);
    expect(c.resolve(SUBSCRIPTION_SERVICE)).toBeInstanceOf(SubscriptionService);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest --config jest.unit.config.js src/modules/subscriptions/__tests__/subscriptions.module.test.ts`
Expected: FAIL — no `subscriptions.module`.

- [ ] **Step 3: Decorate classes**

- `SubscriptionRepository` / `RepoRepository`: `@injectable()`, `@inject(PRISMA)`.
- `SubscriptionValidator`: `@injectable()` (no deps).
- `SubscriptionService`: `@injectable()`, inject `SUBSCRIPTION_REPO`, `REPO_REPO`, `GITHUB_SERVICE` (as `IGitHubService`), `EVENT_BUS`, `SubscriptionValidator` (via class token), `ROOT_LOGGER`. Change the `githubService` field type from `GitHubService` to `IGitHubService` (import from `@/modules/github`).

- [ ] **Step 4: Create subscriptions.module.ts**

```ts
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import { GITHUB_SERVICE } from '@/modules/github';
import { EVENT_BUS, PRISMA } from '@/infrastructure/infra.module';
import { RepoRepository } from './repo.repository';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionService } from './subscription.service';
import { SubscriptionValidator } from './subscription.validator';
import type { SubscriptionResponse } from './subscription.types';

export interface ISubscriptionService {
  subscribe(email: string, repoSlug: string): Promise<void>;
  confirm(token: string): Promise<void>;
  unsubscribe(token: string): Promise<void>;
  getSubscriptions(email: string): Promise<SubscriptionResponse[]>;
}

export const SUBSCRIPTION_REPO: InjectionToken = Symbol('SUBSCRIPTION_REPO');
export const REPO_REPO: InjectionToken = Symbol('REPO_REPO');
export const SUBSCRIPTION_VALIDATOR: InjectionToken = Symbol('SUBSCRIPTION_VALIDATOR');
export const SUBSCRIPTION_SERVICE: InjectionToken<ISubscriptionService> = Symbol('SUBSCRIPTION_SERVICE');

export type { SubscriptionResponse } from './subscription.types';

export function registerSubscriptionsModule(c: DependencyContainer): void {
  c.register(SUBSCRIPTION_REPO, { useClass: SubscriptionRepository });
  c.register(REPO_REPO, { useClass: RepoRepository });
  c.register(SUBSCRIPTION_VALIDATOR, { useClass: SubscriptionValidator });
  c.register(SUBSCRIPTION_SERVICE, { useClass: SubscriptionService });
}
```

Inject `SUBSCRIPTION_REPO`/`REPO_REPO`/`SUBSCRIPTION_VALIDATOR` in `SubscriptionService` using these tokens.

- [ ] **Step 5: Update index.ts**

```ts
export {
  SUBSCRIPTION_SERVICE,
  REPO_REPO,
  SUBSCRIPTION_REPO,
  registerSubscriptionsModule,
  type ISubscriptionService,
  type SubscriptionResponse,
} from './subscriptions.module';
export type {
  ISubscriptionRepository,
  IRepoRepository,
  SubscriptionWithRepo,
} from './subscription.repository.interface';
export { subscriptionRoutes } from './subscription.routes';
```

(`subscriptionRoutes` stays exported — it is the module's HTTP entry, registered by the composition root / app.)

- [ ] **Step 6: Run tests, verify pass**

Run: `npx jest --config jest.unit.config.js src/modules/subscriptions`
Expected: PASS (new module test + existing service/validator tests; existing tests construct via `new`, unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/modules/subscriptions
git commit -m "feat(di): subscriptions module public API (ISubscriptionService token)"
```

### Task 1.6: scanner module public API

**Files:**
- Modify: `scanner.service.ts` (`@injectable`, inject `SUBSCRIPTION_REPO`, `REPO_REPO`, `GITHUB_SERVICE`, `EVENT_BUS`, `METRICS`, `ROOT_LOGGER`)
- Create: `src/modules/scanner/scanner.module.ts`
- Modify: `src/modules/scanner/index.ts`
- Test: `src/modules/scanner/__tests__/scanner.module.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { SCANNER_SERVICE, registerScannerModule } from '@/modules/scanner/scanner.module';
import { ScannerService } from '@/modules/scanner/scanner.service';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { EVENT_BUS, METRICS, PRISMA, registerInfraModule } from '@/infrastructure/infra.module';
import { GITHUB_SERVICE } from '@/modules/github';
import { REPO_REPO, SUBSCRIPTION_REPO } from '@/modules/subscriptions';
import { PinoLogger } from '@/shared/logger';

describe('registerScannerModule', () => {
  it('resolves SCANNER_SERVICE', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, {} as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent' }));
    c.registerInstance(SUBSCRIPTION_REPO, {} as never);
    c.registerInstance(REPO_REPO, {} as never);
    c.registerInstance(GITHUB_SERVICE, {} as never);
    registerInfraModule(c);
    registerScannerModule(c);
    expect(c.resolve(SCANNER_SERVICE)).toBeInstanceOf(ScannerService);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest --config jest.unit.config.js src/modules/scanner/__tests__/scanner.module.test.ts`
Expected: FAIL — no `scanner.module`.

- [ ] **Step 3: Decorate ScannerService + create scanner.module.ts**

```ts
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import { GITHUB_SERVICE } from '@/modules/github';
import { EVENT_BUS, METRICS } from '@/infrastructure/infra.module';
import { REPO_REPO, SUBSCRIPTION_REPO } from '@/modules/subscriptions';
import { ScannerService } from './scanner.service';

export interface IScannerService {
  scanAllRepos(): Promise<void>;
}

export const SCANNER_SERVICE: InjectionToken<IScannerService> = Symbol('SCANNER_SERVICE');

export function registerScannerModule(c: DependencyContainer): void {
  c.register(SCANNER_SERVICE, { useClass: ScannerService });
}
```

Decorate `ScannerService` with `@injectable()` and inject the five tokens. Verify the public method name against `scanner.service.ts` (adjust `IScannerService` to match the actual entry method used by the worker).

- [ ] **Step 4: Update index.ts**

Keep the worker/scheduler builders exported (they are wired by composition root):

```ts
export { SCANNER_SERVICE, registerScannerModule, type IScannerService } from './scanner.module';
export type { ScanResult } from './scanner.service';
export { SCANNER_QUEUE, buildScannerWorker } from './scanner.worker';
export { buildScannerScheduler } from './scanner.scheduler';
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx jest --config jest.unit.config.js src/modules/scanner`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/scanner
git commit -m "feat(di): scanner module public API (IScannerService token)"
```

### Task 1.7: Rewrite build-graph.ts as container builder

**Files:**
- Create: `src/composition/container.ts`
- Modify: `src/main.ts:1-58`
- Modify: `src/composition/shutdown.ts`
- Delete: `src/composition/build-graph.ts` (after main.ts no longer imports it)
- Test: `src/composition/__tests__/container.test.ts`

Note: notification wiring in this task still uses the **in-process** path (existing handlers + worker). Phase 4 replaces it with the client. This keeps Phase 1 behavior-identical.

- [ ] **Step 1: Write the failing smoke test**

```ts
import 'reflect-metadata';
import { buildContainer } from '@/composition/container';
import { SUBSCRIPTION_SERVICE } from '@/modules/subscriptions';
import { SCANNER_SERVICE } from '@/modules/scanner';
import { PinoLogger } from '@/shared/logger';

// Uses a config that does not require live connections for resolution of
// non-async singletons. Async resources are created separately (see container).
describe('buildContainer', () => {
  it('resolves core service tokens without throwing', async () => {
    const logger = PinoLogger.create({ level: 'silent' });
    const { container: c } = await buildContainer(
      {
        databaseUrl: 'postgres://x', redisUrl: 'redis://localhost:6379',
        apiKey: 'k', githubApiBaseUrl: 'https://api.github.com',
        resendApiKey: 'r', emailProvider: 'mock', emailMockUrl: 'http://localhost:4000',
        baseUrl: 'http://localhost:3000', scanIntervalMs: 300000, grpcPort: 50051,
        nodeEnv: 'test', githubCacheTtlSeconds: 600,
        emailFrom: 'x', serviceName: 'test',
      } as never,
      logger,
    );
    expect(c.isRegistered(SUBSCRIPTION_SERVICE)).toBe(true);
    expect(c.isRegistered(SCANNER_SERVICE)).toBe(true);
  });
});
```

> This test will require live redis/bullmq if `buildContainer` eagerly connects. To keep it a pure unit test, `buildContainer` must register async resources lazily OR the test runs in the integration container. Decision: run this in the **integration** config which has redis/postgres. Change command accordingly in Step 2/4.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest --config jest.integration.config.js src/composition/__tests__/container.test.ts`
Expected: FAIL — no `buildContainer` export.

- [ ] **Step 3: Implement container.ts**

```ts
import 'reflect-metadata';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import type { Config } from '@/config/env';
import type { ILogger } from '@/shared/logger';
import { CONFIG, ROOT_LOGGER } from './tokens';
import {
  BULLMQ, PRISMA, REDIS, createInfraInstances, registerInfraModule,
} from '@/infrastructure/infra.module';
import { registerGithubModule } from '@/modules/github';
import { registerSubscriptionsModule } from '@/modules/subscriptions';
import { registerScannerModule } from '@/modules/scanner';
// Notification in-process wiring stays here for Phase 1 (replaced in Phase 4).
import {
  NOTIFICATION_QUEUE, NotificationHandlers, NotificationService,
  MockEmailProvider, ResendEmailProvider, buildNotificationWorker, registerNotificationHandlers,
  type NotificationJob,
} from '@/modules/notifications';
import { SCANNER_QUEUE, SCANNER_SERVICE, buildScannerScheduler, buildScannerWorker } from '@/modules/scanner';
import { EVENT_BUS, METRICS } from '@/infrastructure/infra.module';
import { BullMQProducer, BullMQScheduler, BullMQWorkerFactory } from '@/shared/queue';

export interface BuiltGraph {
  container: DependencyContainer;
  prisma: ReturnType<typeof createInfraInstances> extends Promise<infer R> ? R extends { prisma: infer P } ? P : never : never;
  redis: Awaited<ReturnType<typeof createInfraInstances>>['redis'];
  bullmq: Awaited<ReturnType<typeof createInfraInstances>>['bullmq'];
  notificationWorker: ReturnType<typeof buildNotificationWorker>;
  scannerWorker: ReturnType<typeof buildScannerWorker>;
  scheduler: ReturnType<typeof buildScannerScheduler>;
  notificationProducer: BullMQProducer<NotificationJob>;
}

export async function buildContainer(config: Config, rootLogger: ILogger): Promise<BuiltGraph> {
  const c = rootContainer.createChildContainer();
  c.registerInstance(CONFIG, config);
  c.registerInstance(ROOT_LOGGER, rootLogger);

  const { prisma, redis, bullmq } = await createInfraInstances(config, rootLogger);
  c.registerInstance(PRISMA, prisma);
  c.registerInstance(REDIS, redis);
  c.registerInstance(BULLMQ, bullmq);

  registerInfraModule(c);
  registerGithubModule(c);
  registerSubscriptionsModule(c);
  registerScannerModule(c);

  // --- notification in-process wiring (Phase 1 only) ---
  const eventBus = c.resolve(EVENT_BUS);
  const metrics = c.resolve(METRICS);
  const emailProvider =
    config.emailProvider === 'mock'
      ? new MockEmailProvider(config.emailMockUrl, config.emailFrom, rootLogger.child({ module: 'notifications', component: 'mock-email' }))
      : new ResendEmailProvider(config.resendApiKey, config.emailFrom, rootLogger.child({ module: 'notifications', component: 'resend' }));
  const notificationService = new NotificationService(emailProvider, config.baseUrl, metrics, rootLogger.child({ module: 'notifications' }));
  const notificationProducer = new BullMQProducer<NotificationJob>(NOTIFICATION_QUEUE, bullmq.getConnection(), rootLogger.child({ component: 'bullmq', queue: 'notifications' }));
  const workerFactory = new BullMQWorkerFactory(bullmq.getConnection(), rootLogger.child({ component: 'bullmq' }));
  const scannerScheduler = new BullMQScheduler(SCANNER_QUEUE, bullmq.getConnection(), rootLogger.child({ component: 'bullmq', queue: 'scan-releases' }));
  const notificationHandlers = new NotificationHandlers(notificationProducer, rootLogger.child({ module: 'notifications', component: 'handlers' }));
  registerNotificationHandlers(eventBus, notificationHandlers);
  const notificationWorker = buildNotificationWorker(workerFactory, notificationService, rootLogger.child({ module: 'notifications', component: 'worker' }));
  const scannerWorker = buildScannerWorker(workerFactory, c.resolve(SCANNER_SERVICE));
  const scheduler = buildScannerScheduler(scannerScheduler, config.scanIntervalMs);

  return { container: c, prisma, redis, bullmq, notificationWorker, scannerWorker, scheduler, notificationProducer };
}
```

> `METRICS` is imported at the top alongside the other infra tokens.

- [ ] **Step 4: Update main.ts to use buildContainer + resolve services**

Replace `buildGraph` import/usage. Resolve `SUBSCRIPTION_SERVICE` and the proxy service from the container; pass to `buildApp`/`buildGrpcServer`. The gRPC proxy service: register it in a `grpc.module.ts` (Task 1.9) or keep constructing inline in `main.ts` for now. For Phase 1 keep proxy inline:

```ts
import 'reflect-metadata';
// ...
const graph = await buildContainer(config, rootLogger);
const subscriptionService = graph.container.resolve(SUBSCRIPTION_SERVICE);
await graph.scheduler.start();
const grpcProxyService = new GrpcProxyService({ grpcPort: config.grpcPort, logger: rootLogger.child({ module: 'grpc', component: 'proxy' }) });
const app = await buildApp({ subscriptionService, proxyService: grpcProxyService, metrics: graph.container.resolve(METRICS), apiKey: config.apiKey, logger: rootLogger, grpcPort: config.grpcPort });
const grpcServer = buildGrpcServer({ subscriptionService, apiKey: config.apiKey, logger: rootLogger.child({ module: 'grpc' }) });
// ... start servers, installShutdown(app, grpcServer, graph, grpcProxyService, rootLogger)
```

`buildGrpcServer`/`GrpcServerDeps` currently type `subscriptionService: SubscriptionService` (concrete). Change that type to `ISubscriptionService` (import from `@/modules/subscriptions`). Same for `AppDependencies.subscriptionService` in `app.ts:25` and `GrpcProxyService` consumers.

- [ ] **Step 5: Update shutdown.ts**

Change signature to accept `graph: BuiltGraph` + `grpcProxyService` and close `graph.notificationWorker`, `graph.scannerWorker`, `graph.scheduler`, `graph.notificationProducer`, `graph.bullmq`, `graph.redis`, `graph.prisma` (same order as before).

- [ ] **Step 6: Delete build-graph.ts**

```bash
git rm src/composition/build-graph.ts
```

- [ ] **Step 7: Build + run smoke test + full unit suite**

Run: `npm run build`
Expected: exits 0.
Run: `npx jest --config jest.integration.config.js src/composition/__tests__/container.test.ts`
Expected: PASS.
Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(di): replace build-graph manual wiring with tsyringe container"
```

### Task 1.8: Verify app boots end-to-end (one process)

- [ ] **Step 1: Run integration tests**

Run: `npm run test:integration`
Expected: PASS — confirms HTTP + gRPC + DB still work with the container.

- [ ] **Step 2: Commit (if any fixups)**

```bash
git commit -am "fix(di): integration fixups after container migration" || echo "nothing to commit"
```

---

## Phase 2: dependency-cruiser boundaries

### Task 2.1: Install + configure dependency-cruiser

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `.dependency-cruiser.cjs`

- [ ] **Step 1: Install**

Run: `npm install -D dependency-cruiser`
Expected: added to devDependencies.

- [ ] **Step 2: Create .dependency-cruiser.cjs**

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-deep-import',
      severity: 'error',
      comment: 'Modules may only import another module via its *.module.ts public API.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: [
          '^src/modules/$1/',                       // same module: allowed
          '^src/modules/[^/]+/[^/]+\\.module\\.ts$', // public API of any module: allowed
        ],
      },
    },
    {
      name: 'modules-no-composition',
      severity: 'error',
      comment: 'Feature modules must not import composition roots or services.',
      from: { path: '^src/modules/' },
      to: { path: '^src/(composition|services)/' },
    },
    {
      name: 'shared-is-leaf',
      severity: 'error',
      comment: 'shared/** is cross-cutting and must not depend on feature modules.',
      from: { path: '^src/shared/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)index\\.ts$'] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require'] },
    exclude: { path: '(\\.test\\.ts$|__tests__|/public/)' },
  },
};
```

- [ ] **Step 3: Add scripts**

In `package.json` scripts:

```json
"lint:boundaries": "depcruise src --config .dependency-cruiser.cjs",
"boundaries:graph": "depcruise src --config .dependency-cruiser.cjs --output-type dot > docs/architecture/deps.dot"
```

Change `"lint"` to: `"biome check . && npm run lint:boundaries"`.

- [ ] **Step 4: Run boundaries**

Run: `npm run lint:boundaries`
Expected: exits 0 (no violations). If violations appear, they are real — fix the offending import to go through the module's `*.module.ts`, then re-run.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .dependency-cruiser.cjs
git commit -m "build(boundaries): enforce module boundaries with dependency-cruiser"
```

### Task 2.2: Remove the custom boundary script

**Files:**
- Delete: `scripts/check-module-boundaries.ts`

- [ ] **Step 1: Confirm nothing else references it**

Run: `grep -rn "check-module-boundaries" package.json src scripts`
Expected: only matches that you are about to remove. (The `lint:boundaries` script was already repointed in Task 2.1.)

- [ ] **Step 2: Delete + verify lint**

```bash
git rm scripts/check-module-boundaries.ts
```
Run: `npm run lint`
Expected: biome passes + dependency-cruiser passes.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(boundaries): remove custom check-module-boundaries script"
```

### Task 2.3: Generate boundaries doc + graph

**Files:**
- Create: `docs/architecture/module-boundaries.md`
- Create: `docs/architecture/deps.dot` (generated)

- [ ] **Step 1: Generate the graph**

Run: `npm run boundaries:graph`
Expected: `docs/architecture/deps.dot` written. (If graphviz `dot` is installed, optionally `dot -T svg docs/architecture/deps.dot -o docs/architecture/deps.svg`.)

- [ ] **Step 2: Write module-boundaries.md**

Document: each module, its public surface (the `*.module.ts` exports / tokens / interfaces), the dependency-cruiser rules, and embed/link the graph. Include a table:

```markdown
| Module | Public API (token → interface) | May depend on |
| ------ | ------------------------------ | ------------- |
| github | GITHUB_SERVICE → IGitHubService | infra |
| subscriptions | SUBSCRIPTION_SERVICE → ISubscriptionService | github, infra |
| scanner | SCANNER_SERVICE → IScannerService | subscriptions, github, infra |
| notifications (Phase 3: own service) | HTTP/gRPC API | — |
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/module-boundaries.md docs/architecture/deps.dot
git commit -m "docs(architecture): document module boundaries + dependency graph"
```

---

## Phase 3: Extract notification service (standalone)

### Task 3.1: notification.proto

**Files:**
- Create: `proto/notification.proto`

- [ ] **Step 1: Write the proto** (exact content from spec)

```proto
syntax = "proto3";
package notification;

service NotificationService {
  rpc SendConfirmation (ConfirmationRequest) returns (AckResponse);
  rpc SendReleaseNotification (ReleaseRequest) returns (AckResponse);
}
message ConfirmationRequest { string email = 1; string confirm_token = 2; string repo = 3; }
message Release { string tag_name = 1; string name = 2; string html_url = 3; string published_at = 4; }
message ReleaseRequest { string email = 1; string unsubscribe_token = 2; string repo = 3; Release release = 4; }
message AckResponse { string status = 1; string job_id = 2; }
```

- [ ] **Step 2: Commit**

```bash
git add proto/notification.proto
git commit -m "feat(notif): add notification service proto"
```

### Task 3.2: Move notification internals to services/notification

**Files:**
- Move: `src/modules/notifications/{notification.service.ts,email.provider.ts,resend.provider.ts,mock-email.provider.ts,notification.worker.ts,notification.queue.ts,templates/}` → `src/services/notification/internal/`
- Move their tests alongside.
- Keep: `notification.handlers.ts` stays in the **monolith** (it becomes the client caller in Phase 4) — do NOT move it.

- [ ] **Step 1: Move files**

```bash
git mv src/modules/notifications/notification.service.ts src/services/notification/internal/notification.service.ts
git mv src/modules/notifications/email.provider.ts src/services/notification/internal/email.provider.ts
git mv src/modules/notifications/resend.provider.ts src/services/notification/internal/resend.provider.ts
git mv src/modules/notifications/mock-email.provider.ts src/services/notification/internal/mock-email.provider.ts
git mv src/modules/notifications/notification.worker.ts src/services/notification/internal/notification.worker.ts
git mv src/modules/notifications/notification.queue.ts src/services/notification/internal/notification.queue.ts
git mv src/modules/notifications/templates src/services/notification/internal/templates
git mv src/modules/notifications/__tests__ src/services/notification/internal/__tests__
```

- [ ] **Step 2: Fix imports**

`notification.service.ts` imports `ReleaseEventPayload` from `@/shared/events`. Keep that import (shared is allowed). Update any relative imports broken by the move (templates path is still relative `./templates/...`).

`notification.queue.ts` imports `ReleaseEventPayload` from `@/shared/events` — keep.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: fails only where the old barrel `src/modules/notifications/index.ts` still re-exports moved files. Proceed to Task 3.3 which rewrites/relocates the barrel and container usage; you will get this green by end of Phase 3/4. For now, temporarily comment the moved exports in the old `index.ts` so the build that the notification service needs can proceed, OR jump to Task 3.3 before building.

> Sequencing note: do Task 3.3 and 3.4 before re-running the full build. Commit the move now.

- [ ] **Step 4: Commit the move**

```bash
git add -A
git commit -m "refactor(notif): move notification internals to services/notification"
```

### Task 3.3: ingress service + container for notification process

**Files:**
- Create: `src/services/notification/ingress.service.ts`
- Create: `src/services/notification/container.ts`
- Test: `src/services/notification/__tests__/ingress.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import 'reflect-metadata';
import { IngressService } from '@/services/notification/ingress.service';

describe('IngressService', () => {
  it('enqueues a confirmation job and returns a jobId', async () => {
    const enqueued: any[] = [];
    const producer = { enqueue: async (name: string, data: any) => { enqueued.push({ name, data }); }, close: async () => {} };
    const svc = new IngressService(producer as never, { info() {}, child() { return this; } } as never);
    const res = await svc.enqueueConfirmation({ email: 'a@b.c', confirmToken: 't', repo: 'o/r' });
    expect(res.status).toBe('accepted');
    expect(enqueued[0].name).toBe('send-confirmation');
    expect(enqueued[0].data).toMatchObject({ type: 'confirmation', email: 'a@b.c', confirmToken: 't', repo: 'o/r' });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest --config jest.unit.config.js src/services/notification/__tests__/ingress.service.test.ts`
Expected: FAIL — no `ingress.service`.

- [ ] **Step 3: Implement ingress.service.ts**

```ts
import type { ILogger } from '@/shared/logger';
import type { IQueueProducer } from '@/shared/queue';
import type { ReleaseEventPayload } from '@/shared/events';
import type { NotificationJob } from './internal/notification.queue';

const RETRY = { attempts: 3, backoff: { type: 'exponential' as const, delay: 2000 } };

export interface IngressAck { status: 'accepted'; jobId: string; }

export class IngressService {
  constructor(
    private readonly producer: IQueueProducer<NotificationJob>,
    private readonly logger: ILogger,
  ) {}

  async enqueueConfirmation(p: { email: string; confirmToken: string; repo: string }): Promise<IngressAck> {
    await this.producer.enqueue('send-confirmation', { type: 'confirmation', ...p }, RETRY);
    this.logger.info({ email: p.email }, 'Confirmation enqueued');
    return { status: 'accepted', jobId: `${p.email}:confirmation` };
  }

  async enqueueRelease(p: { email: string; unsubscribeToken: string; repo: string; release: ReleaseEventPayload }): Promise<IngressAck> {
    await this.producer.enqueue('send-release-notification', { type: 'release-notification', ...p }, RETRY);
    this.logger.info({ email: p.email, repo: p.repo }, 'Release notification enqueued');
    return { status: 'accepted', jobId: `${p.email}:release` };
  }
}
```

> `IQueueProducer.enqueue` returns `Promise<void>` today; BullMQ has a job id but the interface hides it. The synthetic `jobId` above is sufficient for the ack. (Optional later: widen the interface to return the real id.)

- [ ] **Step 4: Implement container.ts** (plain wiring; tsyringe optional here — keep simple)

```ts
import type { Config } from '@/config/env';
import type { ILogger } from '@/shared/logger';
import { BullMQConnection, BullMQProducer, BullMQWorkerFactory } from '@/shared/queue';
import { METRIC_DEFINITIONS, PrometheusMetricsCollector } from '@/shared/metrics';
import { IngressService } from './ingress.service';
import { NotificationService } from './internal/notification.service';
import { MockEmailProvider } from './internal/mock-email.provider';
import { ResendEmailProvider } from './internal/resend.provider';
import { buildNotificationWorker } from './internal/notification.worker';
import { NOTIFICATION_QUEUE, type NotificationJob } from './internal/notification.queue';

export async function buildNotificationGraph(config: Config, logger: ILogger) {
  const bullmq = new BullMQConnection(config.redisUrl, logger.child({ component: 'bullmq' }));
  const metrics = new PrometheusMetricsCollector(METRIC_DEFINITIONS, { defaultMetricsPrefix: 'notif_' });
  const emailProvider = config.emailProvider === 'mock'
    ? new MockEmailProvider(config.emailMockUrl, config.emailFrom, logger.child({ component: 'mock-email' }))
    : new ResendEmailProvider(config.resendApiKey, config.emailFrom, logger.child({ component: 'resend' }));
  const service = new NotificationService(emailProvider, config.baseUrl, metrics, logger.child({ component: 'service' }));
  const producer = new BullMQProducer<NotificationJob>(NOTIFICATION_QUEUE, bullmq.getConnection(), logger.child({ component: 'producer' }));
  const worker = buildNotificationWorker(new BullMQWorkerFactory(bullmq.getConnection(), logger), service, logger);
  const ingress = new IngressService(producer, logger.child({ component: 'ingress' }));
  return { bullmq, metrics, producer, worker, ingress };
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `npx jest --config jest.unit.config.js src/services/notification/__tests__/ingress.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/notification/ingress.service.ts src/services/notification/container.ts src/services/notification/__tests__/ingress.service.test.ts
git commit -m "feat(notif): ingress service + standalone container"
```

### Task 3.4: HTTP + gRPC servers for notification service

**Files:**
- Create: `src/services/notification/http/schema.ts`
- Create: `src/services/notification/http/server.ts`
- Create: `src/services/notification/grpc/notification.server.ts`
- Test: `src/services/notification/__tests__/http.server.test.ts`

- [ ] **Step 1: Write failing HTTP test**

```ts
import 'reflect-metadata';
import { buildNotificationHttpServer } from '@/services/notification/http/server';

describe('notification HTTP server', () => {
  it('POST /notifications/confirmation returns 202 and enqueues', async () => {
    const calls: any[] = [];
    const ingress = { enqueueConfirmation: async (p: any) => { calls.push(p); return { status: 'accepted', jobId: 'j' }; }, enqueueRelease: async () => ({ status: 'accepted', jobId: 'j' }) };
    const app = await buildNotificationHttpServer({ ingress: ingress as never, apiKey: 'k', logger: { info() {}, error() {}, child() { return this; } } as never });
    const res = await app.inject({ method: 'POST', url: '/notifications/confirmation', headers: { 'x-api-key': 'k' }, payload: { email: 'a@b.c', confirmToken: 't', repo: 'o/r' } });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'accepted' });
    expect(calls[0]).toMatchObject({ email: 'a@b.c', confirmToken: 't', repo: 'o/r' });
  });

  it('returns 401 with bad api key', async () => {
    const ingress = { enqueueConfirmation: async () => ({ status: 'accepted', jobId: 'j' }), enqueueRelease: async () => ({ status: 'accepted', jobId: 'j' }) };
    const app = await buildNotificationHttpServer({ ingress: ingress as never, apiKey: 'k', logger: { info() {}, error() {}, child() { return this; } } as never });
    const res = await app.inject({ method: 'POST', url: '/notifications/confirmation', headers: { 'x-api-key': 'wrong' }, payload: { email: 'a@b.c', confirmToken: 't', repo: 'o/r' } });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest --config jest.unit.config.js src/services/notification/__tests__/http.server.test.ts`
Expected: FAIL — no `http/server`.

- [ ] **Step 3: Implement schema.ts**

```ts
export const confirmationSchema = {
  body: { type: 'object', required: ['email', 'confirmToken', 'repo'],
    properties: { email: { type: 'string' }, confirmToken: { type: 'string' }, repo: { type: 'string' } } },
} as const;

export const releaseSchema = {
  body: { type: 'object', required: ['email', 'unsubscribeToken', 'repo', 'release'],
    properties: {
      email: { type: 'string' }, unsubscribeToken: { type: 'string' }, repo: { type: 'string' },
      release: { type: 'object', required: ['tagName', 'name', 'htmlUrl', 'publishedAt'],
        properties: { tagName: { type: 'string' }, name: { type: 'string' }, htmlUrl: { type: 'string' }, publishedAt: { type: 'string' } } },
    } },
} as const;
```

- [ ] **Step 4: Implement http/server.ts**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { ILogger } from '@/shared/logger';
import type { IngressService } from '../ingress.service';
import { confirmationSchema, releaseSchema } from './schema';

export interface NotificationHttpDeps { ingress: IngressService; apiKey: string; logger: ILogger; }

export async function buildNotificationHttpServer(deps: NotificationHttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', (req, reply, done) => {
    const key = req.headers['x-api-key'];
    if (key !== deps.apiKey) { reply.code(401).send({ message: 'Unauthorized' }); return; }
    done();
  });
  app.post('/notifications/confirmation', { schema: confirmationSchema }, async (req, reply) => {
    const ack = await deps.ingress.enqueueConfirmation(req.body as never);
    reply.code(202).send(ack);
  });
  app.post('/notifications/release', { schema: releaseSchema }, async (req, reply) => {
    const ack = await deps.ingress.enqueueRelease(req.body as never);
    reply.code(202).send(ack);
  });
  return app;
}
```

- [ ] **Step 5: Implement grpc/notification.server.ts**

```ts
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { ILogger } from '@/shared/logger';
import type { IngressService } from '../ingress.service';

const PROTO_PATH = path.join(__dirname, '..', '..', '..', '..', 'proto', 'notification.proto');

export interface NotificationGrpcDeps { ingress: IngressService; apiKey: string; logger: ILogger; }

function checkKey(call: grpc.ServerUnaryCall<any, any>, apiKey: string): boolean {
  const m = call.metadata.get('x-api-key');
  return m.length > 0 && m[0] === apiKey;
}

export function buildNotificationGrpcServer(deps: NotificationGrpcDeps): grpc.Server {
  const pkgDef = protoLoader.loadSync(PROTO_PATH, { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true });
  const proto = grpc.loadPackageDefinition(pkgDef) as any;
  const server = new grpc.Server();
  server.addService(proto.notification.NotificationService.service, {
    sendConfirmation: async (call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) => {
      if (!checkKey(call, deps.apiKey)) { cb({ code: grpc.status.UNAUTHENTICATED, message: 'Unauthorized' }); return; }
      try {
        const { email, confirmToken, repo } = call.request;
        const ack = await deps.ingress.enqueueConfirmation({ email, confirmToken, repo });
        cb(null, { status: ack.status, jobId: ack.jobId });
      } catch (err) { deps.logger.error({ err }, 'gRPC sendConfirmation failed'); cb({ code: grpc.status.INTERNAL, message: 'Internal error' }); }
    },
    sendReleaseNotification: async (call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) => {
      if (!checkKey(call, deps.apiKey)) { cb({ code: grpc.status.UNAUTHENTICATED, message: 'Unauthorized' }); return; }
      try {
        const { email, unsubscribeToken, repo, release } = call.request;
        const ack = await deps.ingress.enqueueRelease({ email, unsubscribeToken, repo, release });
        cb(null, { status: ack.status, jobId: ack.jobId });
      } catch (err) { deps.logger.error({ err }, 'gRPC sendReleaseNotification failed'); cb({ code: grpc.status.INTERNAL, message: 'Internal error' }); }
    },
  });
  return server;
}

export function startNotificationGrpcServer(server: grpc.Server, port: number, logger: ILogger): Promise<void> {
  return new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) { reject(err); return; }
      logger.info({ port }, 'Notification gRPC server listening');
      resolve();
    });
  });
}
```

Note: proto field `confirm_token` → loaded as `confirmToken` because `keepCase:false`. `tag_name`→`tagName` etc. matches the release object shape.

- [ ] **Step 6: Run HTTP test, verify pass**

Run: `npx jest --config jest.unit.config.js src/services/notification/__tests__/http.server.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/notification/http src/services/notification/grpc src/services/notification/__tests__/http.server.test.ts
git commit -m "feat(notif): HTTP + gRPC ingress servers"
```

### Task 3.5: notification main.ts + Dockerfile + compose

**Files:**
- Create: `src/services/notification/main.ts`
- Create: `Dockerfile.notification`
- Modify: `docker-compose.yml`
- Modify: `src/config/env.ts` (add notif transport/url fields + a notif-process config loader, or extend Config)

- [ ] **Step 1: Extend config**

Add to `Config` interface + `loadConfig`:

```ts
notificationHttpUrl: string;   // default 'http://localhost:3100'
notificationGrpcAddr: string;  // default 'localhost:50061'
notificationTransport: 'http' | 'grpc'; // default 'http'
notificationHttpPort: number;  // default 3100
notificationGrpcPort: number;  // default 50061
```

Loaders:
```ts
notificationHttpUrl: process.env.NOTIFICATION_HTTP_URL || 'http://localhost:3100',
notificationGrpcAddr: process.env.NOTIFICATION_GRPC_ADDR || 'localhost:50061',
notificationTransport: (process.env.NOTIFICATION_TRANSPORT as 'http' | 'grpc') || 'http',
notificationHttpPort: Number(process.env.NOTIFICATION_HTTP_PORT) || 3100,
notificationGrpcPort: Number(process.env.NOTIFICATION_GRPC_PORT) || 50061,
```

- [ ] **Step 2: Write main.ts**

```ts
import 'reflect-metadata';
import { buildNotificationGraph } from './container';
import { buildNotificationHttpServer } from './http/server';
import { buildNotificationGrpcServer, startNotificationGrpcServer } from './grpc/notification.server';
import { config } from '@/config/env';
import { PinoLogger } from '@/shared/logger';

async function main() {
  const logger = PinoLogger.create({ level: config.nodeEnv === 'test' ? 'silent' : 'info', pretty: config.nodeEnv === 'development', base: { service: 'notification-service', env: config.nodeEnv } });
  const graph = await buildNotificationGraph(config, logger);

  const http = await buildNotificationHttpServer({ ingress: graph.ingress, apiKey: config.apiKey, logger });
  await http.listen({ port: config.notificationHttpPort, host: '0.0.0.0' });
  logger.info({ port: config.notificationHttpPort }, 'Notification HTTP listening');

  const grpcServer = buildNotificationGrpcServer({ ingress: graph.ingress, apiKey: config.apiKey, logger });
  await startNotificationGrpcServer(grpcServer, config.notificationGrpcPort, logger);

  const shutdown = async () => {
    await http.close(); grpcServer.forceShutdown();
    await graph.worker.close(); await graph.producer.close(); await graph.bullmq.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch((err) => { console.error('notif fatal', err); process.exit(1); });
```

- [ ] **Step 3: Dockerfile.notification**

Copy `Dockerfile` as a base; change the start command to run `dist/services/notification/main.js`. (Same build stage, different entry.)

- [ ] **Step 4: docker-compose.yml — add notification service**

Add a `notification` service: build `Dockerfile.notification`, env `REDIS_URL`, `API_KEY`, `EMAIL_PROVIDER`, `EMAIL_MOCK_URL`, `BASE_URL`, `EMAIL_FROM`, `RESEND_API_KEY`, ports `3100:3100` + `50061:50061`, `depends_on: [redis]`. Add `NOTIFICATION_HTTP_URL`/`NOTIFICATION_GRPC_ADDR`/`NOTIFICATION_TRANSPORT` + `depends_on: notification` to the main app service.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exits 0 — `dist/services/notification/main.js` exists.

- [ ] **Step 6: Commit**

```bash
git add src/services/notification/main.ts Dockerfile.notification docker-compose.yml src/config/env.ts
git commit -m "feat(notif): standalone notification process (main, docker, compose, config)"
```

---

## Phase 4: Monolith calls notification service (HTTP + gRPC clients)

### Task 4.1: NotificationClient interface + HTTP impl

**Files:**
- Create: `src/modules/notifications/notification-client.interface.ts`
- Create: `src/modules/notifications/http-notification.client.ts`
- Test: `src/modules/notifications/__tests__/http-notification.client.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { HttpNotificationClient } from '@/modules/notifications/http-notification.client';

describe('HttpNotificationClient', () => {
  it('POSTs confirmation to the service', async () => {
    const seen: any = {};
    const fetchImpl = async (url: string, init: any) => { seen.url = url; seen.body = JSON.parse(init.body); seen.headers = init.headers; return { ok: true, status: 202, json: async () => ({ status: 'accepted', jobId: 'j' }) } as any; };
    const client = new HttpNotificationClient('http://notif:3100', 'k', { info() {}, error() {}, child() { return this; } } as never, fetchImpl as never);
    await client.sendConfirmation('a@b.c', 't', 'o/r');
    expect(seen.url).toBe('http://notif:3100/notifications/confirmation');
    expect(seen.body).toMatchObject({ email: 'a@b.c', confirmToken: 't', repo: 'o/r' });
    expect(seen.headers['x-api-key']).toBe('k');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest --config jest.unit.config.js src/modules/notifications/__tests__/http-notification.client.test.ts`
Expected: FAIL — no `http-notification.client`.

- [ ] **Step 3: Implement interface + HTTP client**

`notification-client.interface.ts`:

```ts
import type { ReleaseEventPayload } from '@/shared/events';
export interface INotificationClient {
  sendConfirmation(email: string, confirmToken: string, repo: string): Promise<void>;
  sendReleaseNotification(email: string, unsubscribeToken: string, repo: string, release: ReleaseEventPayload): Promise<void>;
}
```

`http-notification.client.ts`:

```ts
import type { ILogger } from '@/shared/logger';
import type { ReleaseEventPayload } from '@/shared/events';
import type { INotificationClient } from './notification-client.interface';

type FetchLike = typeof fetch;

export class HttpNotificationClient implements INotificationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly logger: ILogger,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async post(path: string, body: unknown): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) { this.logger.error({ path, status: res.status }, 'notif http call failed'); throw new Error(`Notification service ${res.status}`); }
  }

  sendConfirmation(email: string, confirmToken: string, repo: string): Promise<void> {
    return this.post('/notifications/confirmation', { email, confirmToken, repo });
  }
  sendReleaseNotification(email: string, unsubscribeToken: string, repo: string, release: ReleaseEventPayload): Promise<void> {
    return this.post('/notifications/release', { email, unsubscribeToken, repo, release });
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx jest --config jest.unit.config.js src/modules/notifications/__tests__/http-notification.client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/notification-client.interface.ts src/modules/notifications/http-notification.client.ts src/modules/notifications/__tests__/http-notification.client.test.ts
git commit -m "feat(notif-client): INotificationClient + HTTP implementation"
```

### Task 4.2: gRPC client impl

**Files:**
- Create: `src/modules/notifications/grpc-notification.client.ts`
- Test: `src/modules/notifications/__tests__/grpc-notification.client.test.ts` (integration — needs a running gRPC server; mark as integration)

- [ ] **Step 1: Implement grpc-notification.client.ts**

```ts
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { ILogger } from '@/shared/logger';
import type { ReleaseEventPayload } from '@/shared/events';
import type { INotificationClient } from './notification-client.interface';

const PROTO_PATH = path.join(__dirname, '..', '..', '..', 'proto', 'notification.proto');

export class GrpcNotificationClient implements INotificationClient {
  private client: any;
  private metadata: grpc.Metadata;

  constructor(addr: string, apiKey: string, private readonly logger: ILogger) {
    const pkgDef = protoLoader.loadSync(PROTO_PATH, { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true });
    const proto = grpc.loadPackageDefinition(pkgDef) as any;
    this.client = new proto.notification.NotificationService(addr, grpc.credentials.createInsecure());
    this.metadata = new grpc.Metadata();
    this.metadata.add('x-api-key', apiKey);
  }

  private call(method: string, payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client[method](payload, this.metadata, (err: grpc.ServiceError | null) => {
        if (err) { this.logger.error({ err, method }, 'notif grpc call failed'); reject(err); } else resolve();
      });
    });
  }

  sendConfirmation(email: string, confirmToken: string, repo: string): Promise<void> {
    return this.call('sendConfirmation', { email, confirmToken, repo });
  }
  sendReleaseNotification(email: string, unsubscribeToken: string, repo: string, release: ReleaseEventPayload): Promise<void> {
    return this.call('sendReleaseNotification', { email, unsubscribeToken, repo, release });
  }
  close(): void { grpc.closeClient(this.client); }
}
```

- [ ] **Step 2: Write integration test**

```ts
import 'reflect-metadata';
import { buildNotificationGrpcServer, startNotificationGrpcServer } from '@/services/notification/grpc/notification.server';
import { GrpcNotificationClient } from '@/modules/notifications/grpc-notification.client';

describe('GrpcNotificationClient (integration)', () => {
  it('round-trips a confirmation through a real gRPC server', async () => {
    const calls: any[] = [];
    const ingress = { enqueueConfirmation: async (p: any) => { calls.push(p); return { status: 'accepted', jobId: 'j' }; }, enqueueRelease: async () => ({ status: 'accepted', jobId: 'j' }) };
    const server = buildNotificationGrpcServer({ ingress: ingress as never, apiKey: 'k', logger: { info() {}, error() {}, child() { return this; } } as never });
    await startNotificationGrpcServer(server, 50099, { info() {}, error() {}, child() { return this; } } as never);
    const client = new GrpcNotificationClient('localhost:50099', 'k', { info() {}, error() {}, child() { return this; } } as never);
    await client.sendConfirmation('a@b.c', 't', 'o/r');
    expect(calls[0]).toMatchObject({ email: 'a@b.c', confirmToken: 't', repo: 'o/r' });
    client.close(); server.forceShutdown();
  });
});
```

- [ ] **Step 3: Run integration test**

Run: `npx jest --config jest.integration.config.js src/modules/notifications/__tests__/grpc-notification.client.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/notifications/grpc-notification.client.ts src/modules/notifications/__tests__/grpc-notification.client.test.ts
git commit -m "feat(notif-client): gRPC implementation + round-trip integration test"
```

### Task 4.3: Rewire handlers to use the client; new notifications barrel + module

**Files:**
- Modify: `src/modules/notifications/notification.handlers.ts`
- Create: `src/modules/notifications/notifications.module.ts`
- Rewrite: `src/modules/notifications/index.ts`
- Modify: `src/composition/container.ts` (remove in-process notif wiring; register client + handlers)
- Modify: `src/composition/shutdown.ts` (client close instead of worker/producer)
- Test: `src/modules/notifications/__tests__/notification.handlers.test.ts` (update existing)

- [ ] **Step 1: Update NotificationHandlers to call the client**

```ts
import type { IEventBus } from '@/shared/events';
import { NEW_RELEASE_DETECTED, SUBSCRIPTION_CREATED } from '@/shared/events';
import type { NewReleaseDetectedEvent, SubscriptionCreatedEvent } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import type { INotificationClient } from './notification-client.interface';

export class NotificationHandlers {
  constructor(private readonly client: INotificationClient, private readonly logger: ILogger) {}

  async onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void> {
    await this.client.sendConfirmation(event.email, event.confirmToken, event.repoSlug);
    this.logger.info({ email: event.email }, 'Confirmation requested');
  }

  async onNewReleaseDetected(event: NewReleaseDetectedEvent): Promise<void> {
    for (const sub of event.subscribers) {
      await this.client.sendReleaseNotification(sub.email, sub.unsubscribeToken, event.repoSlug, event.release);
    }
    this.logger.info({ repo: event.repoSlug, count: event.subscribers.length }, 'Release notifications requested');
  }
}

export const registerNotificationHandlers = (bus: IEventBus, handlers: NotificationHandlers): void => {
  bus.subscribe<SubscriptionCreatedEvent>(SUBSCRIPTION_CREATED, (e) => handlers.onSubscriptionCreated(e));
  bus.subscribe<NewReleaseDetectedEvent>(NEW_RELEASE_DETECTED, (e) => handlers.onNewReleaseDetected(e));
};
```

- [ ] **Step 2: Create notifications.module.ts (monolith-side public API)**

```ts
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import type { Config } from '@/config/env';
import type { ILogger } from '@/shared/logger';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { HttpNotificationClient } from './http-notification.client';
import { GrpcNotificationClient } from './grpc-notification.client';
import type { INotificationClient } from './notification-client.interface';

export type { INotificationClient } from './notification-client.interface';
export { NotificationHandlers, registerNotificationHandlers } from './notification.handlers';

export const NOTIFICATION_CLIENT: InjectionToken<INotificationClient> = Symbol('NOTIFICATION_CLIENT');

export function registerNotificationsModule(c: DependencyContainer): void {
  c.register(NOTIFICATION_CLIENT, {
    useFactory: (dep) => {
      const config = dep.resolve<Config>(CONFIG);
      const logger = dep.resolve<ILogger>(ROOT_LOGGER).child({ module: 'notification-client' });
      return config.notificationTransport === 'grpc'
        ? new GrpcNotificationClient(config.notificationGrpcAddr, config.apiKey, logger)
        : new HttpNotificationClient(config.notificationHttpUrl, config.apiKey, logger);
    },
  });
}
```

- [ ] **Step 3: Rewrite index.ts**

```ts
export {
  NOTIFICATION_CLIENT,
  registerNotificationsModule,
  NotificationHandlers,
  registerNotificationHandlers,
  type INotificationClient,
} from './notifications.module';
```

(All the moved internal exports are gone — they live in `services/notification` now.)

- [ ] **Step 4: Update container.ts**

Remove the entire in-process notif block (email provider, NotificationService, notificationProducer, notificationWorker, handlers wiring). Replace with:

```ts
import { NOTIFICATION_CLIENT, NotificationHandlers, registerNotificationHandlers, registerNotificationsModule } from '@/modules/notifications';
// ...
registerNotificationsModule(c);
const handlers = new NotificationHandlers(c.resolve(NOTIFICATION_CLIENT), rootLogger.child({ module: 'notifications', component: 'handlers' }));
registerNotificationHandlers(c.resolve(EVENT_BUS), handlers);
```

`BuiltGraph` no longer has `notificationWorker` / `notificationProducer`. Keep `scannerWorker`, `scheduler`, `bullmq` (still needed for scanner). Remove the notif fields from the interface and return value.

- [ ] **Step 5: Update shutdown.ts**

Remove `graph.notificationWorker.close()` and `graph.notificationProducer.close()`. If using `GrpcNotificationClient`, optionally resolve + `close()` it. (HTTP client needs no close.)

- [ ] **Step 6: Update existing handlers test**

Rewrite `notification.handlers.test.ts` to inject a fake `INotificationClient` and assert `sendConfirmation` / `sendReleaseNotification` are called (replacing the old producer-enqueue assertions).

```ts
import { NotificationHandlers } from '@/modules/notifications/notification.handlers';
import { SUBSCRIPTION_CREATED } from '@/shared/events';

describe('NotificationHandlers', () => {
  it('calls client.sendConfirmation on subscription.created', async () => {
    const client = { sendConfirmation: jest.fn(async () => {}), sendReleaseNotification: jest.fn(async () => {}) };
    const h = new NotificationHandlers(client as never, { info() {}, child() { return this; } } as never);
    await h.onSubscriptionCreated({ type: SUBSCRIPTION_CREATED, email: 'a@b.c', repoSlug: 'o/r', confirmToken: 't', occurredAt: 'now' } as never);
    expect(client.sendConfirmation).toHaveBeenCalledWith('a@b.c', 't', 'o/r');
  });
});
```

- [ ] **Step 7: Build + unit + boundaries**

Run: `npm run build`
Expected: exits 0.
Run: `npm run test:unit`
Expected: PASS.
Run: `npm run lint:boundaries`
Expected: exits 0 (notifications module now only exposes the client API; scanner/subscriptions unaffected).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(notif): monolith calls notification service via client (HTTP|gRPC)"
```

### Task 4.4: End-to-end with both processes

**Files:**
- Modify: `docker-compose.test.yml` (add notification service for e2e)

- [ ] **Step 1: Add notif service to test compose**

Mirror the main compose notification service, with `EMAIL_PROVIDER=mock` pointing at the existing mock server.

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e`
Expected: PASS — subscription flow triggers confirmation through the separate notif process (mock email receives it).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.test.yml
git commit -m "test(e2e): run notification service as separate process in e2e compose"
```

---

## Phase 5: Benchmark HTTP vs gRPC

### Task 5.1: Benchmark harness

**Files:**
- Modify: `package.json` (devDep `autocannon`, script `bench`)
- Create: `scripts/bench/run.ts`
- Create: `scripts/bench/payloads.ts`

- [ ] **Step 1: Install autocannon**

Run: `npm install -D autocannon @types/autocannon`
Expected: added to devDependencies.

- [ ] **Step 2: payloads.ts**

```ts
export const confirmationPayload = { email: 'bench@example.com', confirmToken: 'tok-bench', repo: 'octocat/hello-world' };
export const releasePayload = {
  email: 'bench@example.com', unsubscribeToken: 'unsub-bench', repo: 'octocat/hello-world',
  release: { tagName: 'v1.2.3', name: 'Release v1.2.3 — the big one with a longish name to grow payload', htmlUrl: 'https://github.com/octocat/hello-world/releases/tag/v1.2.3', publishedAt: '2026-06-11T00:00:00.000Z' },
};
```

- [ ] **Step 3: run.ts** (HTTP via autocannon, gRPC via a timed client loop; same N + concurrency)

```ts
import autocannon from 'autocannon';
import fs from 'node:fs';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { confirmationPayload, releasePayload } from './payloads';

const HTTP_URL = process.env.BENCH_HTTP_URL || 'http://localhost:3100';
const GRPC_ADDR = process.env.BENCH_GRPC_ADDR || 'localhost:50061';
const API_KEY = process.env.API_KEY || 'dev-key';
const DURATION = Number(process.env.BENCH_DURATION || 10); // seconds
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS || 20);

function httpRun(name: string, urlPath: string, body: unknown) {
  return new Promise<any>((resolve, reject) => {
    autocannon({
      url: `${HTTP_URL}${urlPath}`, method: 'POST', connections: CONNECTIONS, duration: DURATION,
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY }, body: JSON.stringify(body),
    }, (err, res) => err ? reject(err) : resolve({
      transport: 'http', op: name,
      reqPerSec: res.requests.average, latencyP50: res.latency.p50, latencyP90: res.latency.p90,
      latencyP99: res.latency.p99, latencyMax: res.latency.max, errors: res.errors, bytesPerSec: res.throughput.average,
    }));
  });
}

function makeGrpcClient() {
  const def = protoLoader.loadSync(path.join(__dirname, '..', '..', 'proto', 'notification.proto'), { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true });
  const proto = grpc.loadPackageDefinition(def) as any;
  return new proto.notification.NotificationService(GRPC_ADDR, grpc.credentials.createInsecure());
}

async function grpcRun(name: string, method: string, payload: any) {
  const client = makeGrpcClient();
  const md = new grpc.Metadata(); md.add('x-api-key', API_KEY);
  const latencies: number[] = []; let errors = 0;
  const endAt = Date.now() + DURATION * 1000;
  const oneCall = () => new Promise<void>((resolve) => {
    const t = process.hrtime.bigint();
    client[method](payload, md, (err: unknown) => { if (err) errors++; latencies.push(Number(process.hrtime.bigint() - t) / 1e6); resolve(); });
  });
  // CONNECTIONS concurrent workers looping until endAt
  await Promise.all(Array.from({ length: CONNECTIONS }, async () => { while (Date.now() < endAt) await oneCall(); }));
  grpc.closeClient(client);
  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
  return {
    transport: 'grpc', op: name, reqPerSec: latencies.length / DURATION,
    latencyP50: pct(50), latencyP90: pct(90), latencyP99: pct(99), latencyMax: latencies[latencies.length - 1] ?? 0,
    errors, bytesPerSec: null,
  };
}

async function main() {
  const results = [
    await httpRun('confirmation', '/notifications/confirmation', confirmationPayload),
    await httpRun('release', '/notifications/release', releasePayload),
    await grpcRun('confirmation', 'sendConfirmation', confirmationPayload),
    await grpcRun('release', 'sendReleaseNotification', releasePayload),
  ];
  const out = { generatedAt: new Date().toISOString(), config: { durationSec: DURATION, connections: CONNECTIONS }, results };
  const dir = path.join(__dirname, '..', '..', 'bench', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = out.generatedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Add bench script**

```json
"bench": "tsx scripts/bench/run.ts"
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/bench
git commit -m "feat(bench): HTTP vs gRPC benchmark harness with JSON output"
```

### Task 5.2: Run the benchmark + capture results

- [ ] **Step 1: Start notification service with mock email**

Run (compose): bring up `redis` + `notification` with `EMAIL_PROVIDER=mock`, e.g.
`docker compose up -d redis notification` (ensure notif env `EMAIL_PROVIDER=mock`, `API_KEY=dev-key`).

- [ ] **Step 2: Run bench**

Run: `set API_KEY=dev-key && npm run bench` (PowerShell: `$env:API_KEY='dev-key'; npm run bench`)
Expected: `bench/results/latest.json` written, JSON printed with 4 result rows.

- [ ] **Step 3: Commit results**

```bash
git add bench/results
git commit -m "chore(bench): capture HTTP vs gRPC benchmark results"
```

---

## Phase 6: Documentation + ADRs

### Task 6.1: HTTP vs gRPC comparison doc

**Files:**
- Create: `docs/architecture/http-vs-grpc.md`

- [ ] **Step 1: Write the comparison**

Read `bench/results/latest.json`. Produce a table (op × transport: req/sec, p50/p90/p99, errors) and a conclusions section: which transport wins on the small vs larger payload, by how much, and the trade-offs (gRPC: binary protobuf, HTTP/2 multiplexing, schema/codegen cost; HTTP/JSON: ubiquity, debuggability, browser-native). Tie back to the assignment ask #3.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/http-vs-grpc.md
git commit -m "docs(architecture): HTTP vs gRPC benchmark comparison + conclusions"
```

### Task 6.2: ADRs

**Files:**
- Create: `docs/adr/007-di-container-tsyringe.md`
- Create: `docs/adr/008-dependency-cruiser-boundaries.md`
- Create: `docs/adr/009-notification-service-extraction.md`
- Create: `docs/adr/010-http-vs-grpc-comparison.md`

- [ ] **Step 1: Write the four ADRs** following the existing ADR format in `docs/adr/`. Each: Context, Decision, Consequences, Alternatives considered.

- 007: why tsyringe over Inversify/Awilix; decorator approach; tokens as public API.
- 008: why dependency-cruiser over the custom script / eslint-boundaries; the rules.
- 009: notification extraction shape (separate process, internal BullMQ, sync ingress API).
- 010: summarize benchmark result + the chosen default transport.

- [ ] **Step 2: Commit**

```bash
git add docs/adr/007-di-container-tsyringe.md docs/adr/008-dependency-cruiser-boundaries.md docs/adr/009-notification-service-extraction.md docs/adr/010-http-vs-grpc-comparison.md
git commit -m "docs(adr): add ADRs 007-010 for refactor decisions"
```

### Task 6.3: README + final verification

**Files:**
- Modify: `README.md` (run instructions for two processes + `npm run bench`)

- [ ] **Step 1: Update README** with: how to run both processes, env vars (`NOTIFICATION_TRANSPORT`), and the benchmark command.

- [ ] **Step 2: Full verification**

Run: `npm run lint`
Expected: biome + boundaries pass.
Run: `npm run test:unit`
Expected: PASS.
Run: `npm run test:integration`
Expected: PASS.
Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): two-process run + benchmark instructions"
```

---

## Done criteria

- `build-graph.ts` gone; tsyringe container wires everything; `npm run build` green.
- Each module exposes token + interface + `register*`; no concrete cross-module class imports.
- `dependency-cruiser` enforces boundaries; custom script deleted; boundaries doc + graph committed.
- Notification runs as a separate process with HTTP + gRPC ingress; monolith calls it via `INotificationClient` (transport switchable by env).
- `npm run bench` emits JSON; `docs/architecture/http-vs-grpc.md` written from real numbers.
- ADRs 007–010 committed. All test suites green.
