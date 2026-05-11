import pino from 'pino';
import type { ILogger, LogBindings } from './logger.interface';

export class PinoLogger implements ILogger {
  constructor(private readonly logger: pino.Logger) {}

  static create(opts: { level: string; pretty: boolean }): PinoLogger {
    const logger = pino({
      level: opts.level,
      transport: opts.pretty
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          }
        : undefined,
    });
    return new PinoLogger(logger);
  }

  info(objOrMsg: LogBindings | string, msg?: string): void {
    if (typeof objOrMsg === 'string') this.logger.info(objOrMsg);
    else this.logger.info(objOrMsg, msg);
  }
  warn(objOrMsg: LogBindings | string, msg?: string): void {
    if (typeof objOrMsg === 'string') this.logger.warn(objOrMsg);
    else this.logger.warn(objOrMsg, msg);
  }
  error(objOrMsg: LogBindings | string, msg?: string): void {
    if (typeof objOrMsg === 'string') this.logger.error(objOrMsg);
    else this.logger.error(objOrMsg, msg);
  }
  debug(objOrMsg: LogBindings | string, msg?: string): void {
    if (typeof objOrMsg === 'string') this.logger.debug(objOrMsg);
    else this.logger.debug(objOrMsg, msg);
  }
  child(bindings: LogBindings): ILogger {
    return new PinoLogger(this.logger.child(bindings));
  }
}
