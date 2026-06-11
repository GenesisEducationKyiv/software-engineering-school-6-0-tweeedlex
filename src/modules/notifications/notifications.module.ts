import { CONFIG, ROOT_LOGGER } from '@/composition/tokens';
import type { Config } from '@/config/env';
import type { ILogger } from '@/shared/logger';
import { type DependencyContainer, type InjectionToken, instanceCachingFactory } from 'tsyringe';
import { GrpcNotificationClient } from './grpc-notification.client';
import { HttpNotificationClient } from './http-notification.client';
import type { INotificationClient } from './notification-client.interface';

export type { INotificationClient } from './notification-client.interface';
export { NotificationHandlers, registerNotificationHandlers } from './notification.handlers';

export const NOTIFICATION_CLIENT: InjectionToken<INotificationClient> =
  Symbol('NOTIFICATION_CLIENT');

export function registerNotificationsModule(c: DependencyContainer): void {
  c.register(NOTIFICATION_CLIENT, {
    useFactory: instanceCachingFactory((dep) => {
      const config = dep.resolve<Config>(CONFIG);
      const logger = dep.resolve<ILogger>(ROOT_LOGGER).child({ module: 'notification-client' });
      return config.notificationTransport === 'grpc'
        ? new GrpcNotificationClient(config.notificationGrpcAddr, config.apiKey, logger)
        : new HttpNotificationClient(config.notificationHttpUrl, config.apiKey, logger);
    }),
  });
}
