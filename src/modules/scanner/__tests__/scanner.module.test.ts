import 'reflect-metadata';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { registerInfraModule } from '@/infrastructure/infra.module';
import { GITHUB_SERVICE } from '@/modules/github';
import { REPO_REPO, SUBSCRIPTION_REPO } from '@/modules/subscriptions';
import { PinoLogger } from '@/shared/logger';
import { container } from 'tsyringe';
import { SCANNER_SERVICE, registerScannerModule } from '../scanner.module';
import { ScannerService } from '../scanner.service';

describe('registerScannerModule', () => {
  it('resolves SCANNER_SERVICE to a ScannerService instance', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, {} as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent', pretty: false }));
    c.registerInstance(SUBSCRIPTION_REPO, {} as never);
    c.registerInstance(REPO_REPO, {} as never);
    c.registerInstance(GITHUB_SERVICE, {} as never);
    registerInfraModule(c);
    registerScannerModule(c);
    expect(c.resolve(SCANNER_SERVICE)).toBeInstanceOf(ScannerService);
  });
});
