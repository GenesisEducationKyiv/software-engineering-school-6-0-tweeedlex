import { ROOT_LOGGER } from '@/composition/tokens';
import { PRISMA } from '@/infrastructure/infra.module';
import { GITHUB_SERVICE, type IGitHubService } from '@/modules/github';
import { CONFIRMATION_SAGA } from '@/modules/saga';
import type { IConfirmationSagaStarter } from '@/modules/saga';
import type { ILogger } from '@/shared/logger';
import type { PrismaClient } from '@prisma/client';
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import { RepoRepository } from './repo.repository';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionService } from './subscription.service';
import type { SubscriptionResponse } from './subscription.types';
import { SubscriptionValidator } from './subscription.validator';

export interface ISubscriptionService {
  subscribe(email: string, repoSlug: string): Promise<void>;
  confirm(token: string): Promise<void>;
  unsubscribe(token: string): Promise<void>;
  getSubscriptions(email: string): Promise<SubscriptionResponse[]>;
}

export const SUBSCRIPTION_REPO: InjectionToken = Symbol('SUBSCRIPTION_REPO');
export const REPO_REPO: InjectionToken = Symbol('REPO_REPO');
export const SUBSCRIPTION_VALIDATOR: InjectionToken<SubscriptionValidator> =
  Symbol('SUBSCRIPTION_VALIDATOR');
export const SUBSCRIPTION_SERVICE: InjectionToken<ISubscriptionService> =
  Symbol('SUBSCRIPTION_SERVICE');
export type { SubscriptionResponse } from './subscription.types';

export function registerSubscriptionsModule(c: DependencyContainer): void {
  c.register(SUBSCRIPTION_REPO, {
    useFactory: (dep) => new SubscriptionRepository(dep.resolve<PrismaClient>(PRISMA)),
  });
  c.register(REPO_REPO, {
    useFactory: (dep) => new RepoRepository(dep.resolve<PrismaClient>(PRISMA)),
  });
  c.register(SUBSCRIPTION_VALIDATOR, { useFactory: () => new SubscriptionValidator() });
  c.register(SUBSCRIPTION_SERVICE, {
    useFactory: (dep) =>
      new SubscriptionService(
        dep.resolve(SUBSCRIPTION_REPO),
        dep.resolve(REPO_REPO),
        dep.resolve<IGitHubService>(GITHUB_SERVICE),
        dep.resolve(SUBSCRIPTION_VALIDATOR),
        dep.resolve<PrismaClient>(PRISMA),
        dep.resolve<IConfirmationSagaStarter>(CONFIRMATION_SAGA),
        dep.resolve<ILogger>(ROOT_LOGGER).child({ module: 'subscriptions' }),
      ),
  });
}
