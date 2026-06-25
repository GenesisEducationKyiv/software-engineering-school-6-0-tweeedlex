export type LogBindings = Record<string, unknown>;
export interface ILogger {
  info(obj: LogBindings, msg?: string): void;
  info(msg: string): void;
  warn(obj: LogBindings, msg?: string): void;
  warn(msg: string): void;
  error(obj: LogBindings, msg?: string): void;
  error(msg: string): void;
  debug(obj: LogBindings, msg?: string): void;
  debug(msg: string): void;
  child(bindings: LogBindings): ILogger;
}
