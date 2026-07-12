import 'reflect-metadata';
import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import { EVENT_BUS, METRICS, registerInfraModule } from '@/infrastructure/infra.module';
import { InProcessEventBus } from '@/shared/events';
import { PinoLogger } from '@/shared/logger';
import { PrometheusMetricsCollector } from '@/shared/metrics';
import { container } from 'tsyringe';

describe('registerInfraModule', () => {
  it('registers event bus and metrics resolvable from the container', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, { redisUrl: 'redis://localhost:6379' } as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent', pretty: false }));
    registerInfraModule(c);
    expect(c.resolve(EVENT_BUS)).toBeInstanceOf(InProcessEventBus);
    expect(c.resolve(METRICS)).toBeInstanceOf(PrometheusMetricsCollector);
  });

  it('returns the SAME event bus and metrics instance on repeated resolve (singleton)', () => {
    const c = container.createChildContainer();
    c.registerInstance(CONFIG, { redisUrl: 'redis://localhost:6379' } as never);
    c.registerInstance(ROOT_LOGGER, PinoLogger.create({ level: 'silent', pretty: false }));
    registerInfraModule(c);
    expect(c.resolve(EVENT_BUS)).toBe(c.resolve(EVENT_BUS));
    expect(c.resolve(METRICS)).toBe(c.resolve(METRICS));
  });
});
