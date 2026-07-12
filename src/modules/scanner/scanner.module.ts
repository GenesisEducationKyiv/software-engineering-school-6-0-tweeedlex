import { ROOT_LOGGER } from '@/composition/tokens';
import { EVENT_BUS, METRICS } from '@/infrastructure/infra.module';
import { GITHUB_SERVICE, type IGitHubService } from '@/modules/github';
import { REPO_REPO, SUBSCRIPTION_REPO } from '@/modules/subscriptions';
import type { IRepoRepository, ISubscriptionRepository } from '@/modules/subscriptions';
import type { IEventBus } from '@/shared/events';
import type { ILogger } from '@/shared/logger';
import type { IMetricsCollector } from '@/shared/metrics';
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import { type ScanResult, ScannerService } from './scanner.service';

export interface IScannerService {
  scanAllRepos(): Promise<ScanResult>;
}

export const SCANNER_SERVICE: InjectionToken<IScannerService> = Symbol('SCANNER_SERVICE');

export function registerScannerModule(c: DependencyContainer): void {
  c.register(SCANNER_SERVICE, {
    useFactory: (dep) =>
      new ScannerService(
        dep.resolve<ISubscriptionRepository>(SUBSCRIPTION_REPO),
        dep.resolve<IRepoRepository>(REPO_REPO),
        dep.resolve<IGitHubService>(GITHUB_SERVICE),
        dep.resolve<IEventBus>(EVENT_BUS),
        dep.resolve<IMetricsCollector>(METRICS),
        dep.resolve<ILogger>(ROOT_LOGGER).child({ module: 'scanner' }),
      ),
  });
}
