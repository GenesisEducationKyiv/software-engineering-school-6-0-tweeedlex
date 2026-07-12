import { randomUUID } from 'node:crypto';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import type { Config } from '@/config/env';
import { PRISMA } from '@/infrastructure/infra.module';
import type { ILogger } from '@/shared/logger';
import { OutboxRepository } from '@/shared/outbox';
import type { PrismaClient } from '@prisma/client';
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import { instanceCachingFactory } from 'tsyringe';
import { type CompensateFn, ConfirmationSaga } from './confirmation-saga';
import { SagaRepository } from './saga.repository';

export const SAGA_REPO: InjectionToken<SagaRepository> = Symbol('SAGA_REPO');
export const OUTBOX_REPO: InjectionToken<OutboxRepository> = Symbol('OUTBOX_REPO');
export const CONFIRMATION_SAGA: InjectionToken<ConfirmationSaga> = Symbol('CONFIRMATION_SAGA');

/** `compensate` is supplied by the composition root (deletes the subscription). */
export function registerSagaModule(c: DependencyContainer, compensate: CompensateFn): void {
  c.register(SAGA_REPO, {
    useFactory: instanceCachingFactory(
      (dep) => new SagaRepository(dep.resolve<PrismaClient>(PRISMA)),
    ),
  });
  c.register(OUTBOX_REPO, {
    useFactory: instanceCachingFactory(
      (dep) => new OutboxRepository(dep.resolve<PrismaClient>(PRISMA)),
    ),
  });
  c.register(CONFIRMATION_SAGA, {
    useFactory: instanceCachingFactory((dep) => {
      const config = dep.resolve<Config>(CONFIG);
      return new ConfirmationSaga(
        dep.resolve(SAGA_REPO),
        dep.resolve(OUTBOX_REPO),
        compensate,
        () => randomUUID(),
        config.sagaTimeoutMs,
        dep.resolve<ILogger>(ROOT_LOGGER).child({ module: 'saga' }),
      );
    }),
  });
}
