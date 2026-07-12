import type { Config } from '@/config/env';
import type { ILogger } from '@/shared/logger';
import type { InjectionToken } from 'tsyringe';

// Root inputs
export const CONFIG: InjectionToken<Config> = Symbol('CONFIG');
export const ROOT_LOGGER: InjectionToken<ILogger> = Symbol('ROOT_LOGGER');
