import 'reflect-metadata';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { PRISMA, registerInfraModule } from '@/infrastructure/infra.module';
import { GITHUB_SERVICE } from '@/modules/github';
import { PinoLogger } from '@/shared/logger';
import { container } from 'tsyringe';
import { CONFIRMATION_SAGA } from '@/modules/saga';
import { SubscriptionService } from '../subscription.service';
import {
  SUBSCRIPTION_SERVICE,
  registerSubscriptionsModule,
} from '../subscriptions.module';

describe('registerSubscriptionsModule', () => {
  it('resolves SUBSCRIPTION_SERVICE to a SubscriptionService instance', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, {} as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent', pretty: false }));
    c.registerInstance(PRISMA, {} as never);
    c.registerInstance(GITHUB_SERVICE, {
      verifyRepo: async () => ({}),
      getLatestRelease: async () => null,
    } as never);
    c.registerInstance(CONFIRMATION_SAGA, {
      start: async () => 'saga-id',
    } as never);
    registerInfraModule(c);
    registerSubscriptionsModule(c);
    expect(c.resolve(SUBSCRIPTION_SERVICE)).toBeInstanceOf(SubscriptionService);
  });
});
