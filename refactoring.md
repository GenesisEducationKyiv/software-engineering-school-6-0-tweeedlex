# План рефакторингу `github-subscriptions-service`

## Context

Кодова база — Node.js/TypeScript сервіс (Fastify + Prisma + BullMQ + Redis + Pino + prom-client + Resend + gRPC). Структура `src/{config,infrastructure,modules,shared}` уже модульна, але має кілька системних проблем:

- `main.ts` тримає весь DI-граф, але всередині модулів є жорсткі залежності від конкретних реалізацій (BullMQ, Pino, prom-client, Prisma).
- Сервіси (`SubscriptionService`, `ScannerService`) знають про BullMQ Queue напряму — погана LCC і неможливо легко змінити транспорт.
- `grpc-proxy.routes.ts` має жирний хендлер, що змішує proto-loading, валідацію методів, проксі-виклик, map статус-кодів — всі в одній функції.
- Логер імпортується як глобальний сінглтон у 13 файлах — це приховані залежності і важко тестувати.
- Метрики жорстко зв'язані з prom-client, метрики визначені, але **жодна з них не інкрементується** в коді (виявлено під час дослідження).
- `subscription.service.subscribe()` робить занадто багато (валідація + GitHub + DB + enqueue) — порушує SRP.
- `subscription.repository.ts` змішує subscription CRUD та repo CRUD.
- У `github.client.ts` дубльована обробка 404/429/error для двох методів; у `github.cache.ts` дубльована get/set логіка.
- Перехресні залежності модулів: scanner і subscription імпортують з notifications напряму — порушує low coupling.
- Немає примусу до меж модулів (Biome не вміє таких правил).

**Мета**: застосувати принципи SOLID (DIP, SRP, ISP) і паттерни GRASP (Pure Fabrication, Indirection, Low Coupling, High Cohesion) — приховати інфраструктурні залежності за інтерфейсами, забезпечити явні межі модулів, явну композицію в одному місці.

**Прийняті рішення з обговорення з користувачем**:
- ORM: тонкий інтерфейс репозиторіїв (типи Prisma можуть витікати) — без повного маппінгу до доменних типів.
- Routes: залишити як є (HTTP routes тонкі), окремий controller-шар не вводити. Але **виділити `GrpcProxyService`** з жирного `grpc-proxy.routes.ts`.
- Queue: повноцінні `IQueueProducer<T>`/`IWorker`/`IScheduler` інтерфейси + BullMQ adapter.
- Logger: `ILogger` інтерфейс + `PinoLogger` реалізація, DI всюди.
- Metrics: `IMetricsCollector` + `PrometheusMetricsCollector` adapter.
- Module boundaries: `index.ts` барелі + кастомний скрипт `scripts/check-module-boundaries.ts`, який підключається до `npm run lint` (без ESLint).
- Cross-module нотифікації: через **domain event bus** (`subscription.service` емітує `SubscriptionCreated`, scanner — `NewReleaseDetected`; handlers у notifications підписуються і enqueue в чергу).
- Розділення `subscribe()`: на приватні методи всередині `SubscriptionService` (не окремі use-case класи).

---

## Архітектура після рефакторингу

```
src/
├── main.ts                          # тонкий — викликає composition
├── app.ts                           # будує Fastify, приймає AppDependencies
├── composition/                     # NEW
│   ├── build-graph.ts               # вся ручна DI-композиція в одній функції
│   └── shutdown.ts                  # SIGTERM/SIGINT teardown
├── config/
│   └── env.ts
├── infrastructure/                  # видаляється повністю — переїжджає в shared
│   └── db/
│       └── prisma-factory.ts        # createPrismaClient(config, logger)
│   └── redis/
│       └── redis-factory.ts         # createRedisClient(config, logger)
├── modules/
│   ├── auth/
│   │   ├── api-key.plugin.ts
│   │   └── index.ts                 # NEW
│   ├── github/
│   │   ├── github.client.ts
│   │   ├── github.cache.ts
│   │   ├── github.service.ts
│   │   ├── github.types.ts
│   │   └── index.ts                 # NEW
│   ├── grpc/
│   │   ├── grpc.server.ts
│   │   ├── grpc-proxy.service.ts    # NEW — жирна логіка переїжджає сюди
│   │   ├── grpc-proxy.routes.ts     # SHRUNK — тонкий route
│   │   └── index.ts                 # NEW
│   ├── metrics/
│   │   ├── metrics.routes.ts        # отримує IMetricsCollector через DI
│   │   └── index.ts                 # NEW
│   ├── notifications/
│   │   ├── notification.service.ts
│   │   ├── notification.queue.ts    # NEW — DTO задач, ім'я черги
│   │   ├── notification.handlers.ts # NEW — підписники event bus → enqueue
│   │   ├── notification.worker.ts   # SHRUNK — buildNotificationWorker()
│   │   ├── resend.provider.ts
│   │   ├── email.provider.ts
│   │   ├── templates/
│   │   └── index.ts                 # NEW
│   ├── scanner/
│   │   ├── scanner.service.ts       # емітує події замість enqueue
│   │   ├── scanner.worker.ts        # SHRUNK — buildScannerWorker()
│   │   ├── scanner.scheduler.ts     # SHRUNK — buildScannerScheduler()
│   │   └── index.ts                 # NEW
│   └── subscriptions/
│       ├── subscription.service.ts        # розділений на приватні helpers
│       ├── subscription.validator.ts      # NEW
│       ├── subscription.repository.ts     # SRP: тільки subscription rows
│       ├── repo.repository.ts             # NEW — SRP: тільки repo rows
│       ├── subscription.repository.interface.ts # NEW — ISubscriptionRepository, IRepoRepository
│       ├── subscription.mapper.ts         # NEW — pure DTO маппінг
│       ├── subscription.routes.ts
│       ├── subscription.schema.ts
│       ├── subscription.types.ts
│       └── index.ts                       # NEW
├── shared/
│   ├── errors/
│   ├── events/                            # NEW — IEventBus + типи подій
│   │   ├── event-bus.interface.ts
│   │   ├── in-process-event-bus.ts
│   │   ├── subscription-events.ts
│   │   ├── release-events.ts
│   │   └── index.ts
│   ├── logger/                            # NEW — ILogger + PinoLogger
│   │   ├── logger.interface.ts
│   │   ├── pino-logger.ts
│   │   └── index.ts
│   ├── metrics/                           # NEW — IMetricsCollector + Prometheus impl
│   │   ├── metrics.interface.ts
│   │   ├── prometheus-metrics-collector.ts
│   │   ├── definitions.ts
│   │   └── index.ts
│   ├── queue/                             # NEW — IQueueProducer/IWorker/IScheduler + BullMQ
│   │   ├── queue.types.ts
│   │   ├── queue.errors.ts
│   │   ├── queue-producer.interface.ts
│   │   ├── worker.interface.ts
│   │   ├── scheduler.interface.ts
│   │   ├── bullmq/
│   │   │   ├── bullmq-connection.ts
│   │   │   ├── bullmq-producer.ts
│   │   │   ├── bullmq-worker-factory.ts
│   │   │   └── bullmq-scheduler.ts
│   │   └── index.ts
│   └── utils/
└── scripts/
    └── check-module-boundaries.ts       # NEW — npm run lint:boundaries
```

---

## A. Logger abstraction (DIP)

### Файли

- **NEW `src/shared/logger/logger.interface.ts`**:
  ```ts
  export type LogBindings = Record<string, unknown>;
  export interface ILogger {
    info(obj: LogBindings, msg?: string): void;
    info(msg: string): void;
    warn(obj: LogBindings, msg?: string): void; warn(msg: string): void;
    error(obj: LogBindings, msg?: string): void; error(msg: string): void;
    debug(obj: LogBindings, msg?: string): void; debug(msg: string): void;
    child(bindings: LogBindings): ILogger;
  }
  ```
- **NEW `src/shared/logger/pino-logger.ts`**:
  ```ts
  export class PinoLogger implements ILogger {
    constructor(private readonly pino: pino.Logger);
    static create(opts: { level: string; pretty: boolean }): PinoLogger;
    // overloaded info/warn/error/debug, child()
  }
  ```
- **NEW `src/shared/logger/index.ts`** — re-export `ILogger`, `LogBindings`, `PinoLogger`.
- **DELETE `src/config/logger.ts`** — пакет pino має залишитись лише в `pino-logger.ts`.

### Композиція в main.ts

Корневий логер створюється один раз, кожен модуль/компонент отримує `child` з прив'язками типу `{ module: 'subscriptions' }` чи `{ component: 'redis' }`. Сервіси НЕ викликають `.child()` самі (хіба що для under-job контексту, як `logger.child({ jobId })` у worker handler).

### Файли, що змінюються (13 importers)

| # | Файл | Що отримує через конструктор |
|---|---|---|
| 1 | `src/main.ts` → `src/composition/build-graph.ts` | створює root, передає в усе |
| 2 | `src/infrastructure/db/prisma-client.ts` → `src/infrastructure/db/prisma-factory.ts` | `createPrismaClient(config, logger)` factory function |
| 3 | `src/infrastructure/redis/redis-client.ts` → `redis-factory.ts` | factory function |
| 4 | `src/infrastructure/queue/connection.ts` → **DELETE** | поглинається `BullMQConnection` |
| 5 | `src/modules/github/github.client.ts` | `constructor(token, logger, metrics)` |
| 6 | `src/modules/github/github.cache.ts` | `constructor(redis, ttl, logger)` |
| 7 | `src/modules/scanner/scanner.service.ts` | `+logger` |
| 8 | `src/modules/scanner/scanner.scheduler.ts` | DELETE (поглинається `BullMQScheduler`) |
| 9 | `src/modules/scanner/scanner.worker.ts` | SHRUNK — логування переїжджає в `BullMQWorkerFactory` |
| 10 | `src/modules/subscriptions/subscription.service.ts` | `+logger` |
| 11 | `src/modules/notifications/notification.worker.ts` | SHRUNK |
| 12 | `src/modules/notifications/resend.provider.ts` | `constructor(apiKey, fromAddress, logger)` |
| 13 | `src/modules/grpc/grpc.server.ts` | `GrpcServerDeps += logger` |

---

## B. Queue abstraction (DIP, Pure Fabrication)

### Інтерфейси (`src/shared/queue/`)

**`queue.types.ts`**:
```ts
export interface JobOptions {
  attempts?: number;
  backoff?: { type: 'exponential' | 'fixed'; delay: number };
  delay?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
  jobId?: string;
}
export interface Job<T> { readonly id: string | undefined; readonly name: string; readonly data: T; readonly attemptsMade: number; }
export type JobHandler<T> = (job: Job<T>) => Promise<void>;
export interface WorkerOptions { concurrency?: number; }
```

**`queue.errors.ts`**: `QueueError`, `QueueConnectionError`, `JobEnqueueError`.

**`queue-producer.interface.ts`**:
```ts
export interface IQueueProducer<T> {
  enqueue(jobName: string, data: T, options?: JobOptions): Promise<void>;
  close(): Promise<void>;
}
```

**`worker.interface.ts`**:
```ts
export interface IWorker { close(): Promise<void>; }
export interface IWorkerFactory {
  createWorker<T>(queueName: string, handler: JobHandler<T>, options?: WorkerOptions): IWorker;
}
```

**`scheduler.interface.ts`**:
```ts
export interface IScheduler {
  scheduleRepeatable(jobName: string, data: unknown, everyMs: number): Promise<void>;
  removeAllRepeatable(): Promise<void>;
  stop(): Promise<void>;
}
```

### BullMQ adapter (`src/shared/queue/bullmq/`)

- `BullMQConnection(redisUrl, logger)` — замінює `src/infrastructure/queue/connection.ts`.
- `BullMQProducer<T>(queueName, connection, logger) implements IQueueProducer<T>` — лазі-створює `new Queue(...)`; маппить `JobOptions` 1:1 в BullMQ; огортає помилки в `JobEnqueueError`.
- `BullMQWorkerFactory(connection, logger) implements IWorkerFactory` — `.createWorker()` будує `new Worker(...)` з обгорткою хендлера + автоматично навішує `completed`/`failed` логування через `ILogger` (видаляє дубль з `NotificationWorker`/`ScannerWorker`).
- `BullMQScheduler(queueName, connection, logger) implements IScheduler` — переймає `ScannerScheduler.start()` логіку (видалити старі repeatable, додати новий).

### Видалити

- `src/infrastructure/queue/connection.ts` (вся директорія `infrastructure/queue/` зникає).
- `NotificationWorker` клас із `notification.worker.ts` — переїжджає у функцію (див. D).
- `ScannerWorker` клас, `ScannerScheduler` клас.

### Як сервіси використовують

**Рішення: один producer на чергу** — обидва сервіси (`SubscriptionService`, `ScannerService`) отримують один і той же `INotificationProducer = IQueueProducer<NotificationJob>`. Бо черга **тільки одна** (`notifications`), а `data.type` discriminates job type — це поточна архітектура; розколювати на дві черги — без виграшу.

**Важлива примітка**: у фінальному дизайні після введення Domain Event Bus (розділ E), `SubscriptionService` і `ScannerService` НЕ отримують `INotificationProducer` взагалі. Producer отримує лише `NotificationHandlers` всередині notifications модуля. Сервіси публікують події; handlers їх ловлять і enqueue.

---

## C. Metrics abstraction (DIP)

### Інтерфейс (`src/shared/metrics/metrics.interface.ts`)

```ts
export type MetricLabels = Record<string, string | number>;
export interface MetricsRenderResult { contentType: string; body: string; }
export interface IMetricsCollector {
  incrementCounter(name: string, labels?: MetricLabels, value?: number): void;
  observeHistogram(name: string, value: number, labels?: MetricLabels): void;
  setGauge(name: string, value: number, labels?: MetricLabels): void;
  render(): Promise<MetricsRenderResult>;
}
```

### Реалізація (`prometheus-metrics-collector.ts`)

```ts
export type MetricDef =
  | { kind: 'counter';  name: string; help: string; labelNames?: string[] }
  | { kind: 'histogram'; name: string; help: string; labelNames?: string[]; buckets?: number[] }
  | { kind: 'gauge';    name: string; help: string; labelNames?: string[] };

export class PrometheusMetricsCollector implements IMetricsCollector {
  constructor(defs: MetricDef[], opts?: { defaultMetricsPrefix?: string });
  // ...методи з інтерфейсу
}
```

Внутрішньо: приватний `Map<string, Counter|Histogram|Gauge>`, кидає clear error, якщо метрика не знайдена. `render()` повертає `{contentType: registry.contentType, body: await registry.metrics()}`. **prom-client має залишитися лише у цьому файлі.**

### Визначення метрик (`src/shared/metrics/definitions.ts`)

Єдиний файл з масивом `METRIC_DEFINITIONS` та `METRIC_NAMES` (типизовані константи імен).

### Видалення

- `src/modules/metrics/metrics.plugin.ts` — повністю видалити, його `metricsRegistry` експорту більше немає.
- `src/modules/metrics/metrics.routes.ts` — приймає `{ metrics: IMetricsCollector }` через plugin options (як `subscriptionRoutes` приймає сервіс).

### Wire-up інструментування (важливо!)

Зараз метрики **визначені, але ніколи не інкрементуються**. У рамках цього рефакторингу мінімально підключити:
- `http_requests_total` + `http_request_duration_seconds` — Fastify hooks (`onRequest` зберігає `startTime`, `onResponse` фіксує).
- `notifications_sent_total` — в `NotificationService.sendConfirmationEmail`/`sendReleaseNotification`.
- `scan_releases_total`, `new_releases_detected_total` — в `ScannerService.scanAllRepos`/`scanSingleRepo`.
- `github_api_calls_total` — в `GitHubClient.fetchGitHub` хелпері.
- `active_subscriptions` (gauge) — пропустити, винести в follow-up.

`NotificationService`, `ScannerService`, `GitHubClient` отримують `IMetricsCollector` через DI.

---

## D. Repository split (SRP — пункт 10)

### Інтерфейси (`subscription.repository.interface.ts`)

```ts
import type { Repo, Subscription } from '@prisma/client';
export type SubscriptionWithRepo = Subscription & { repo: Repo };

export interface ISubscriptionRepository {
  findByEmailAndRepo(email: string, repoId: string): Promise<Subscription | null>;
  create(data: { email: string; repoId: string; confirmToken: string; unsubscribeToken: string }): Promise<Subscription>;
  findByConfirmToken(token: string): Promise<SubscriptionWithRepo | null>;
  findByUnsubscribeToken(token: string): Promise<SubscriptionWithRepo | null>;
  confirmSubscription(id: string): Promise<void>;
  deleteSubscription(id: string): Promise<void>;
  findAllByEmail(email: string): Promise<SubscriptionWithRepo[]>;       // ВЖЕ повертає сирі рядки
  findAllConfirmedByRepoId(repoId: string): Promise<Subscription[]>;
}

export interface IRepoRepository {
  findOrCreate(owner: string, name: string): Promise<Repo>;
  findDistinctConfirmed(): Promise<Repo[]>;
  updateLastSeenTag(repoId: string, tag: string): Promise<void>;
}
```

### Реалізації — два окремі класи

- **`SubscriptionRepository implements ISubscriptionRepository`** — лише subscription-методи.
- **NEW `RepoRepository implements IRepoRepository`** в `src/modules/subscriptions/repo.repository.ts` — лише repo-методи.

Обидва приймають `PrismaClient` у конструкторі. Назви методів у `RepoRepository` без `Repo` суфікса (бо клас уже про це).

### DTO mapping — окремий mapper

**NEW `subscription.mapper.ts`** — pure функції:
```ts
export const toSubscriptionResponse = (row: SubscriptionWithRepo): SubscriptionResponse => ({
  email: row.email,
  repo: `${row.repo.owner}/${row.repo.name}`,
  confirmed: row.confirmed,
  last_seen_tag: row.repo.lastSeenTag,
});
export const toSubscriptionResponses = (rows: SubscriptionWithRepo[]): SubscriptionResponse[] => rows.map(toSubscriptionResponse);
```

`SubscriptionService.getSubscriptions` стає: validate → `repo.findAllByEmail(email)` → `toSubscriptionResponses(rows)`.

### Як сервіси використовують

- `SubscriptionService` отримує `ISubscriptionRepository` + `IRepoRepository`.
- `ScannerService` отримує `ISubscriptionRepository` + `IRepoRepository`.

---

## E. Domain Event Bus (GRASP Indirection, Low Coupling — пункт 11)

### Інтерфейс (`src/shared/events/event-bus.interface.ts`)

```ts
export interface DomainEvent { readonly type: string; }
export type EventHandler<E> = (event: E) => void | Promise<void>;

export interface IEventBus {
  publish<E extends DomainEvent>(event: E): Promise<void>;
  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): () => void;  // returns unsubscribe fn
}
```

### Реалізація (`in-process-event-bus.ts`)

```ts
export class InProcessEventBus implements IEventBus {
  constructor(logger: ILogger);
  // ...
}
```

- Внутрішня мапа: `Map<string, EventHandler<any>[]>`.
- `publish` викликає handlers серіально з try/catch — помилка одного handler не зриває інші, логується, але **не пробрасується** (це cross-module signal, publisher уже зберіг state).
- `subscribe` повертає unsubscribe-функцію (зручно в тестах).

### Типи подій

Кожна подія визначена в `src/shared/events/`:
```ts
// subscription-events.ts
export const SUBSCRIPTION_CREATED = 'subscription.created' as const;
export interface SubscriptionCreatedEvent extends DomainEvent {
  type: typeof SUBSCRIPTION_CREATED;
  email: string;
  repoSlug: string;       // "owner/name"
  confirmToken: string;
  occurredAt: string;     // ISO
}

// release-events.ts
export const NEW_RELEASE_DETECTED = 'scanner.new-release-detected' as const;
export interface ReleaseEventPayload {
  tagName: string; name: string | null; htmlUrl: string; publishedAt: string | null;
}
export interface NewReleaseDetectedEvent extends DomainEvent {
  type: typeof NEW_RELEASE_DETECTED;
  repoSlug: string;
  release: ReleaseEventPayload;
  subscribers: Array<{ email: string; unsubscribeToken: string }>;
  occurredAt: string;
}
```

**Чому subscribers у payload `NewReleaseDetected`**: альтернатива — handler у notifications робить повторний запит до repo — це fan-out з зайвою DB-роботою і додає залежність `notifications → IRepoRepository`. Передача списку залишає всю DB-роботу в scanner; notifications лише фронтить чергу.

### Публікація

- `SubscriptionService.subscribe()` після `repo.create(...)` викликає `this.events.publish<SubscriptionCreatedEvent>({...})` замість `Queue.add(...)`. Видаляється `bullConnection`, `notificationQueue`, `getNotificationQueue()`, імпорт `bullmq`/`NOTIFICATION_QUEUE`.
- `ScannerService.scanSingleRepo()` після `updateLastSeenTag` публікує `NewReleaseDetectedEvent` з усіма підписниками (одна подія на нову версію, не одна на підписника).

### Підписники в notifications (`notification.handlers.ts`)

```ts
export class NotificationHandlers {
  constructor(private readonly producer: IQueueProducer<NotificationJob>, private readonly logger: ILogger) {}
  async onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void>;
  async onNewReleaseDetected(event: NewReleaseDetectedEvent): Promise<void>;
}

export const registerNotificationHandlers = (
  bus: IEventBus,
  handlers: NotificationHandlers,
): void => {
  bus.subscribe(SUBSCRIPTION_CREATED, (e) => handlers.onSubscriptionCreated(e));
  bus.subscribe(NEW_RELEASE_DETECTED, (e) => handlers.onNewReleaseDetected(e));
};
```

**Handler — а не сервіс** — вибирає політику BullMQ retry/backoff (`attempts: 3, backoff: { type: 'exponential', delay: 2000 }`). Це правильно: це queueing concern.

### Реєстрація в композиції

`build-graph.ts` викликає `registerNotificationHandlers(bus, handlers)` **після** створення bus і producer, але **до** старту workers — щоб жодна подія не вистрілила без handler.

---

## F. SubscriptionService refactor (SRP — пункт 12)

### Структура

**NEW `src/modules/subscriptions/subscription.validator.ts`**:
```ts
export class SubscriptionValidator {
  assertRepoSlug(slug: string): void;
  assertEmail(email: string): void;
  assertToken(token: string): void;
  parseSlug(slug: string): { owner: string; name: string };  // throw + parse
}
```
(Внутрішньо делегує `@/shared/utils/validation.ts` — ті утиліти залишаються спільними.)

### Конструктор `SubscriptionService` після

```ts
class SubscriptionService {
  constructor(
    private readonly repo: ISubscriptionRepository,
    private readonly repoRepo: IRepoRepository,
    private readonly githubService: GitHubService,
    private readonly events: IEventBus,
    private readonly validator: SubscriptionValidator,
    private readonly logger: ILogger,
  ) {}
  // public unchanged
  subscribe(email, repoSlug): Promise<void>;
  confirm(token): Promise<void>;
  unsubscribe(token): Promise<void>;
  getSubscriptions(email): Promise<SubscriptionResponse[]>;
  // private — використовуються лише в subscribe
  private async ensureRepoExists(owner, name): Promise<Repo>;
  private async assertNotDuplicate(email, repoId): Promise<void>;
  private async createSubscriptionRow(email, repoId): Promise<{ confirmToken; unsubscribeToken }>;
  private emitSubscriptionCreated(payload): void;
}
```

### Новий порядок у `subscribe(email, repoSlug)`

1. `this.validator.assertEmail(email)` — **зараз цього немає, треба додати**.
2. `const { owner, name } = this.validator.parseSlug(repoSlug)`.
3. `const repoRecord = await this.ensureRepoExists(owner, name)` (verifyRepo + findOrCreate).
4. `await this.assertNotDuplicate(email, repoRecord.id)`.
5. `const { confirmToken } = await this.createSubscriptionRow({ email, repoId: repoRecord.id })`.
6. `await this.events.publish<SubscriptionCreatedEvent>({ type: SUBSCRIPTION_CREATED, email, repoSlug, confirmToken, occurredAt: new Date().toISOString() })`.
7. `this.logger.info({ email, repo: repoSlug }, 'Subscription created, event emitted')`.

`confirm` і `unsubscribe` — залишити майже як є, лише на старті додати `this.validator.assertToken(token)`.

`getSubscriptions` — `validate → repo.findAllByEmail() → toSubscriptionResponses()`.

---

## G. GitHub module deduplication (пункт 8)

### `github.client.ts`

```ts
class GitHubClient {
  constructor(githubToken: string | undefined, logger: ILogger, metrics: IMetricsCollector);
  getRepo(owner, name): Promise<GitHubRepo>;
  getLatestRelease(owner, name): Promise<GitHubRelease | null>;
  // private
  private async fetchGitHub<T>(path: string, opts?: {
    treat404As: 'throw' | 'null';
    notFoundMessage?: string;
  }): Promise<T | null>;
  private parseRateLimitHeaders(h: Headers): GitHubRateLimitHeaders;
  private handleRateLimit(h: Headers): void;
  private extractRetryAfter(h: Headers): number;
}
```

Тіло `fetchGitHub<T>`:
1. `fetch(GITHUB_API_BASE + path, { headers: this.headers })`.
2. Інкрементує `github_api_calls_total { endpoint: path, status: response.status }`.
3. 404 → якщо `treat404As: 'null'` → return `null`; інакше throw `NotFoundError(opts.notFoundMessage ?? 'Not found')`.
4. 429 або (403 + remaining=0) → throw `RateLimitError`.
5. `!response.ok` → throw generic `Error`.
6. `this.handleRateLimit(response.headers)`.
7. return `response.json() as T`.

`getRepo` стає однією лінією, `getLatestRelease` — також.

### `github.cache.ts`

```ts
type CacheKind = 'repo' | 'release';
class GitHubCache {
  constructor(redis: RedisClient, ttlSeconds: number, logger: ILogger);
  getRepo(owner, name): Promise<GitHubRepo | null>;
  setRepo(owner, name, repo): Promise<void>;
  getRelease(owner, name): Promise<GitHubRelease | null | undefined>;  // undefined=miss, null=known-empty
  setRelease(owner, name, release): Promise<void>;
  // private
  private key(kind: CacheKind, owner, name): string;
  private async getJson<T>(key: string): Promise<T | undefined>;
  private async setJson(key: string, value: unknown): Promise<void>;
}
```

`getJson<T>` розрізняє "no key in redis" (return `undefined`) від "stored as null" (return `null`) — потрібно для `getRelease` triple-state semantics.

---

## H. Notification module restructure

### Файли

- **NEW `notification.queue.ts`** — контракт між handler-що-enqueue і worker-що-consume:
  ```ts
  export const NOTIFICATION_QUEUE = 'notifications';
  export interface ConfirmationJob { type: 'confirmation'; email; confirmToken; repo; }
  export interface ReleaseNotificationJob {
    type: 'release-notification'; email; unsubscribeToken; repo;
    release: ReleaseEventPayload;   // FLATTENED, не сирий GitHubRelease
  }
  export type NotificationJob = ConfirmationJob | ReleaseNotificationJob;
  ```
- **NEW `notification.handlers.ts`** — `NotificationHandlers` клас + `registerNotificationHandlers`.
- **`notification.worker.ts` SHRUNK** до factory function:
  ```ts
  export const buildNotificationWorker = (
    factory: IWorkerFactory,
    service: NotificationService,
    logger: ILogger,
  ): IWorker => factory.createWorker<NotificationJob>(NOTIFICATION_QUEUE, async (job) => {
    if (job.data.type === 'confirmation') {
      await service.sendConfirmationEmail(job.data.email, job.data.confirmToken, job.data.repo);
    } else {
      await service.sendReleaseNotification(job.data.email, job.data.unsubscribeToken, job.data.repo, job.data.release);
    }
  });
  ```
- `notification.service.ts` — без змін у API, але:
    - `sendReleaseNotification` приймає `ReleaseEventPayload` замість `GitHubRelease` (декаплінг від github типів).
    - `+constructor(emailProvider, baseUrl, metrics, logger)` — додано `IMetricsCollector` (інкрементує `notifications_sent_total`).

### `ResendEmailProvider` — `FROM_EMAIL` в config

- `src/config/env.ts`: додати `emailFrom: string` зі дефолтом `'GitHub Release Notifier <noreply@tweeedlex.xyz>'`.
- Конструктор: `constructor(apiKey: string, fromAddress: string, logger: ILogger)`.

---

## I. Scanner module restructure

### `scanner.service.ts`

```ts
class ScannerService {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly repoRepo: IRepoRepository,
    private readonly githubService: GitHubService,
    private readonly events: IEventBus,
    private readonly metrics: IMetricsCollector,
    private readonly logger: ILogger,
  ) {}
  async scanAllRepos(): Promise<ScanResult>;
  private async scanSingleRepo(repo: Repo): Promise<PerRepoScanResult>;  // винесено
}
```

`scanSingleRepo` повертає discriminated union `{ status: 'no-releases' | 'no-change' | 'new-release', newTag? }`. На `'new-release'` — emits `NewReleaseDetectedEvent` (з підписниками). `RateLimitError` ПРОБРАСУЄТЬСЯ нагору; `scanAllRepos` ловить його і виходить з циклу.

Метрики: `scan_releases_total` на старті `scanAllRepos`, `new_releases_detected_total` на кожен `'new-release'`.

### `scanner.worker.ts` SHRUNK

```ts
export const SCANNER_QUEUE = 'scan-releases';
export type ScanJobData = Record<string, never>;
export const buildScannerWorker = (
  factory: IWorkerFactory,
  service: ScannerService,
): IWorker => factory.createWorker<ScanJobData>(SCANNER_QUEUE, async () => {
  await service.scanAllRepos();
}, { concurrency: 1 });
```

### `scanner.scheduler.ts` SHRUNK

```ts
export const buildScannerScheduler = (
  scheduler: IScheduler,
  intervalMs: number,
) => ({
  start: () => scheduler.scheduleRepeatable('scan-releases', {}, intervalMs),
  stop: () => scheduler.stop(),
});
```

(Логіка "видалити старі repeatable перед додаванням" живе в `BullMQScheduler.scheduleRepeatable`.)

---

## J. grpc-proxy refactor (пункт 4)

### NEW `src/modules/grpc/grpc-proxy.service.ts`

```ts
export interface GrpcProxyResult { status: number; body: unknown; }
export interface IGrpcProxyService {
  call(method: string, payload: Record<string, unknown>, apiKey: string): Promise<GrpcProxyResult>;
}

export class GrpcProxyService implements IGrpcProxyService {
  constructor(deps: { grpcPort: number; logger: ILogger });
  call(method, payload, apiKey): Promise<GrpcProxyResult>;
  close(): void;
}
```

Все, що зараз у `grpc-proxy.routes.ts`:
- завантаження proto;
- створення gRPC client (один раз у конструкторі);
- whitelist методів;
- камелкейс трансформація;
- map gRPC status → HTTP status;
- скрабінг повідомлень помилок —

переїжджає сюди.

### `grpc-proxy.routes.ts` ПІСЛЯ

```ts
const grpcProxyPlugin: FastifyPluginAsync<{ proxyService: IGrpcProxyService; apiKey: string }> = async (fastify, opts) => {
  const apiKeyGuard = createApiKeyGuard(opts.apiKey);
  fastify.post<{ Body: { method: string; payload: Record<string, unknown> } }>(
    '/grpc-proxy',
    { preHandler: [apiKeyGuard] },
    async (request, reply) => {
      const { method, payload } = request.body;
      const apiKey = request.headers['x-api-key'] as string;
      const { status, body } = await opts.proxyService.call(method, payload, apiKey);
      return reply.status(status).send(body);
    },
  );
};
```

Все. Жодних `grpc`, `protoLoader`, статус-маппінгу в route.

`GrpcProxyService` створюється в `build-graph.ts` і передається в `app.ts` через `AppDependencies.proxyService`.

---

## K. Module boundaries (пункт 5)

### Підхід

Кастомний скрипт без ESLint. **`scripts/check-module-boundaries.ts`** — окремий standalone script, виконується через tsx.

### Алгоритм

```
1. Glob src/**/*.ts (виключити *.test.ts, *.spec.ts).
2. Для кожного файлу F:
   a. Визначити "owner" F:
      - src/modules/<X>/** → owner = "modules/<X>"
      - src/main.ts АБО src/composition/** → owner = "<composition-root>" (allow deep imports)
      - інакше (shared/, infrastructure/, config/, app.ts) → owner = "<infra>"
   b. Парс імпортів через TypeScript compiler API (ts.createSourceFile + walk ImportDeclaration).
   c. Для кожного імпорту S:
      - Розібрати "@/X" → "src/X"; "./", "../" → relative resolve → normalize to "src/...".
      - npm пакети / "node:..." → skip.
      - Якщо target під src/modules/<Y>/..., target.module = "modules/<Y>", інакше "<non-module>".
      - Якщо target = "<non-module>" → PASS.
      - Якщо same module → PASS.
      - Cross-module:
        * Файли в COMPOSITION_ROOTS ('src/main.ts', 'src/composition/**') → дозволено deep імпорти.
        * Інакше — імпорт має резолвитись до `src/modules/<Y>` або `src/modules/<Y>/index` (barrel only).
        * Інакше — violation.
3. Виводимо violations у форматі:
   [boundary] <file>
     imports "<specifier>"
     → target module: <Y>
     → resolved path: <path>
     Expected: "@/modules/<Y>" (barrel)
4. Exit 1 якщо хоч одна violation; інакше exit 0.
```

Використати лише вбудовані залежності (`typescript` уже є; для glob — простий рекурсивний `fs.readdir` без зовнішнього пакета).

### npm wire-up

`package.json`:
```json
"lint:boundaries": "tsx scripts/check-module-boundaries.ts",
"lint": "biome check . && npm run lint:boundaries"
```

### Очікувані поточні violations (мають бути усунені рефакторингом)

- `scanner.service.ts → notifications/notification.worker` ✓ зникне (через event bus)
- `subscription.service.ts → notifications/notification.worker` ✓ зникне
- `scanner.scheduler.ts → ./scanner.worker` — same module, OK; крім того, обидва файли SHRUNK
- `app.ts → grpc-proxy.routes.ts`, `subscription.routes.ts` — оновити на barrel імпорти

---

## L. Module barrels (`index.ts`)

### `src/modules/auth/index.ts`
```ts
export { createApiKeyGuard } from './api-key.plugin';
```

### `src/modules/github/index.ts`
```ts
export { GitHubService } from './github.service';
export { GitHubClient } from './github.client';
export { GitHubCache } from './github.cache';
export type { GitHubRepo, GitHubRelease } from './github.types';
// GitHubRateLimitHeaders — internal, не експортувати
```

### `src/modules/grpc/index.ts`
```ts
export { buildGrpcServer, startGrpcServer } from './grpc.server';
export type { GrpcServerDeps } from './grpc.server';
export { GrpcProxyService } from './grpc-proxy.service';
export type { IGrpcProxyService } from './grpc-proxy.service';
export { grpcProxyRoutes } from './grpc-proxy.routes';
```

### `src/modules/metrics/index.ts`
```ts
export { metricsRoutes } from './metrics.routes';
```

### `src/modules/notifications/index.ts`
```ts
export { NotificationService } from './notification.service';
export { ResendEmailProvider } from './resend.provider';
export type { EmailProvider } from './email.provider';
export { NOTIFICATION_QUEUE } from './notification.queue';
export type { NotificationJob, ConfirmationJob, ReleaseNotificationJob } from './notification.queue';
export { NotificationHandlers, registerNotificationHandlers } from './notification.handlers';
export { buildNotificationWorker } from './notification.worker';
```

### `src/modules/scanner/index.ts`
```ts
export { ScannerService } from './scanner.service';
export type { ScanResult } from './scanner.service';
export { SCANNER_QUEUE, buildScannerWorker } from './scanner.worker';
export { buildScannerScheduler } from './scanner.scheduler';
```

### `src/modules/subscriptions/index.ts`
```ts
export { SubscriptionService } from './subscription.service';
export { SubscriptionRepository } from './subscription.repository';
export { RepoRepository } from './repo.repository';
export type { ISubscriptionRepository, IRepoRepository, SubscriptionWithRepo } from './subscription.repository.interface';
export { SubscriptionValidator } from './subscription.validator';
export { subscriptionRoutes } from './subscription.routes';
export type { SubscriptionResponse } from './subscription.types';
// mapper/schema — internal
```

### `src/shared/*` — НЕ робимо barrels для everything

`shared/errors`, `shared/utils` — залишаються deep імпорти (це утиліти, не модулі). АЛЕ:
- `shared/events/index.ts` — barrel (типи подій імпортуються з кількох модулів).
- `shared/logger/index.ts`, `shared/metrics/index.ts`, `shared/queue/index.ts` — barrels.

---

## M. Composition root (`src/composition/build-graph.ts`)

main.ts після рефакторингу — тонкий ~30-50 рядків:
1. Створити root logger.
2. Запустити міграції.
3. `const graph = await buildGraph(config, rootLogger)`.
4. Запустити Fastify і gRPC server.
5. `installShutdown(graph, ...)`.

`buildGraph()` — імперативний ланцюжок (без DI-контейнера), повертає об'єкт зі всіма побудованими інстансами:

```
1. logger (already created, just bound)
2. prisma = createPrismaClient(config, rootLogger.child({component:'prisma'}))
3. redis = createRedisClient(config, rootLogger.child({component:'redis'}))
4. bullmq = new BullMQConnection(config.redisUrl, rootLogger.child({component:'bullmq'}))
5. metrics = new PrometheusMetricsCollector(METRIC_DEFINITIONS, {defaultMetricsPrefix:'github_notifier_'})
6. eventBus = new InProcessEventBus(rootLogger.child({component:'event-bus'}))
7. subscriptionRepo = new SubscriptionRepository(prisma)
8. repoRepo = new RepoRepository(prisma)
9. githubLogger = rootLogger.child({module:'github'})
   githubClient = new GitHubClient(config.githubToken, githubLogger.child({component:'client'}), metrics)
   githubCache = new GitHubCache(redis, config.githubCacheTtlSeconds, githubLogger.child({component:'cache'}))
   githubService = new GitHubService(githubClient, githubCache)
10. emailProvider = new ResendEmailProvider(config.resendApiKey, config.emailFrom, rootLogger.child({module:'notifications', component:'resend'}))
    notificationService = new NotificationService(emailProvider, config.baseUrl, metrics, rootLogger.child({module:'notifications'}))
11. validator = new SubscriptionValidator()
    subscriptionService = new SubscriptionService(subscriptionRepo, repoRepo, githubService, eventBus, validator, rootLogger.child({module:'subscriptions'}))
    scannerService = new ScannerService(subscriptionRepo, repoRepo, githubService, eventBus, metrics, rootLogger.child({module:'scanner'}))
12. notificationProducer = new BullMQProducer<NotificationJob>(NOTIFICATION_QUEUE, bullmq.getConnection(), rootLogger.child({component:'bullmq', queue:'notifications'}))
    workerFactory = new BullMQWorkerFactory(bullmq.getConnection(), rootLogger.child({component:'bullmq'}))
    scannerScheduler = new BullMQScheduler(SCANNER_QUEUE, bullmq.getConnection(), rootLogger.child({component:'bullmq', queue:'scan-releases'}))
13. notificationHandlers = new NotificationHandlers(notificationProducer, rootLogger.child({module:'notifications', component:'handlers'}))
    registerNotificationHandlers(eventBus, notificationHandlers)
14. notificationWorker = buildNotificationWorker(workerFactory, notificationService, rootLogger.child({module:'notifications', component:'worker'}))
    scannerWorker = buildScannerWorker(workerFactory, scannerService)
    scheduler = buildScannerScheduler(scannerScheduler, config.scanIntervalMs)
    await scheduler.start()
15. grpcProxyService = new GrpcProxyService({grpcPort: config.grpcPort, logger: rootLogger.child({module:'grpc', component:'proxy'})})
16. return Graph
```

`installShutdown()` — у зворотному порядку: app.close → grpcServer.forceShutdown → grpcProxyService.close → notificationWorker.close → scannerWorker.close → scheduler.stop → notificationProducer.close → bullmq.close → redis.close → prisma.$disconnect.

### `AppDependencies` after refactor

```ts
export interface AppDependencies {
  subscriptionService: SubscriptionService;
  proxyService: IGrpcProxyService;
  metrics: IMetricsCollector;
  apiKey: string;
  logger: ILogger;
  grpcPort?: number;
}
```

`app.ts` — динамічні імпорти оновити на barrel:
- `await import('./modules/subscriptions')` (не `'./modules/subscriptions/subscription.routes'`)
- те ж для `grpc` та `metrics`.

Додати HTTP metrics hooks: `onRequest` зберігає `startTime` у `request.startTime`, `onResponse` — observe histogram + increment counter з лейблами `{method, route, status}`. (Поточний `onResponse` лог замінити або зберегти.)

---

## Послідовність виконання (рекомендоване розбиття на PRs)

1. **PR 1**: Logger abstraction (A) + Repository split (D). Низький ризик, механічно, без зміни поведінки.
2. **PR 2**: Queue abstraction (B). Витягає BullMQ за інтерфейс; сервіси втрачають `bullConnection`.
3. **PR 3**: Domain Event Bus (E) + SubscriptionService refactor (F) + Scanner refactor (I) + Notifications restructure (H). Прибирає cross-module імпорти між сервісами.
4. **PR 4**: Metrics abstraction (C) + GitHub dedup (G) + GrpcProxyService (J). Незалежні групи.
5. **PR 5**: Module barrels (L) + Composition extraction (M) + Boundaries script (K). Останній — щоб скрипт ловив зелений стан.

Усі PR можна звести в один великий, але треба сильна тестова сітка.

---

## Verification (end-to-end)

Перевірити, що рефакторинг не зламав поведінку:

### Static checks
```powershell
npm run lint                 # biome + boundaries — має бути чисто
npm run build                # tsc — має скомпілюватись
```

### Unit tests
```powershell
npm test                     # Jest — існуючі тести мають пройти
```
Існуючі тестові файли (з `git status`): `notification.worker.test.ts`, `resend.provider.test.ts`, `scanner.scheduler.test.ts`, `scanner.worker.test.ts`, `grpc.server.test.ts`, `github.cache.test.ts`, `github.client.test.ts` — деякі переоформити під нові class-shapes (моки замість конкретних залежностей; передавати `ILogger` мок замість підміни сінглтона).

Додати unit-тести для нових абстракцій:
- `InProcessEventBus` — publish/subscribe/unsubscribe, handler error isolation.
- `SubscriptionValidator` — assertions throw correct AppError types.
- `PrometheusMetricsCollector` — render outputs OpenMetrics format, unknown metric throws.
- `BullMQProducer` — enqueue maps JobOptions correctly (integration test з Redis).
- `subscription.mapper.ts` — pure mapping.

### Integration / E2E
1. `docker-compose up redis postgres` (або еквівалент).
2. `npm run db:migrate` → `npm run dev`.
3. Curl: `POST /api/subscribe` з валідним `{email, repo}` → 200; подивитись логи: має бути `Subscription created, event emitted`. Redis: ключ `bull:notifications:*` має з'явитись (job в черзі).
4. Через 1-2 секунди — лог `Notification job completed` (worker обробив).
5. `GET /api/subscriptions?email=...` (з API key) → бачимо subscription.
6. Force trigger scanner: дочекатись інтервалу або вручну додати job в Redis.
7. `GET /metrics` → бачимо інкрементовані значення (`notifications_sent_total`, `scan_releases_total`).
8. gRPC: `grpcurl -d '{"email":...,"repo":...}' -H "x-api-key: ..." localhost:50051 subscription.SubscriptionService/Subscribe` → відповідь без помилок.
9. Browser → `POST /api/grpc-proxy { method:"Subscribe", payload:{...} }` → 200 (підтверджує `GrpcProxyService` працює).
10. SIGTERM → лог `Application shut down gracefully` (порядок shutdown коректний).

### Boundary check
- Спробувати додати тестовий файл `src/modules/scanner/test-violation.ts` з `import { NotificationService } from '../notifications/notification.service'` — `npm run lint:boundaries` має фейлити.
- Видалити файл — має проходити.

---

## Критичні файли (де буде найбільше змін)

- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\main.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\app.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\subscriptions\subscription.service.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\subscriptions\subscription.repository.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\scanner\scanner.service.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\scanner\scanner.scheduler.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\scanner\scanner.worker.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\notifications\notification.worker.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\notifications\notification.service.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\notifications\resend.provider.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\github\github.client.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\github\github.cache.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\grpc\grpc-proxy.routes.ts`
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\modules\metrics\metrics.plugin.ts` (delete)
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\config\logger.ts` (delete)
- `D:\programming\pet\current\genesis-ses\github-subscriptions-service\src\infrastructure\queue\connection.ts` (delete)

---

## Існуючі функції/утиліти, які використати повторно

- `src/shared/utils/validation.ts` (`isValidEmail`, `isValidRepoFormat`, `isValidToken`, `parseRepo`) — використати з `SubscriptionValidator`.
- `src/shared/utils/token.ts` (`generateToken`) — використати в `SubscriptionService.createSubscriptionRow`.
- `src/shared/errors/app-error.ts` (`AppError`, `ValidationError`, `NotFoundError`, `ConflictError`, `RateLimitError`) — використовуються скрізь, не дублювати.
- `src/shared/errors/error-handler.ts` — лишити без змін.
- `src/modules/notifications/templates/{confirmation,release}.ts` — без змін.
- `src/modules/subscriptions/subscription.schema.ts` — без змін.

---

## Прийняті trade-offs (для довідки)

1. **Prisma типи витікають через інтерфейси** — це усвідомлено, бо повний маппінг до доменних типів — велика робота і непотрібна без реального плану на Mongo.
2. **`scanner.subscribers` payload в event** — несе DB-навантаження, але уникає circular dependency notifications→repo.
3. **In-memory event bus, синхронний** — не для розподілених систем. Якщо колись треба буде винести events за процес — підмінимо реалізацію `IEventBus`.
4. **Composition root deep-imports дозволені** — без цього довелось би експортувати всі concrete classes через барелі, що знівелювало б боковий ефект меж модулів. Скрипт `check-module-boundaries.ts` має список `COMPOSITION_ROOTS = ['src/main.ts', 'src/composition/**']`.
5. **Метрики інкрементуються тепер реально** — це функціональна зміна (counters стають ненульовими). Якщо треба строго zero behavior change — пропустити wire-up і лишити метрики stub.
