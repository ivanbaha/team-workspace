import { ConsoleLogger, Injectable, Optional } from '@nestjs/common';
import { LoggerConfigService } from './config';
import { formatJson, formatPretty } from './formatters';

import type { LoggerConfig, LoggerLevel } from './config';
import type { LogEntry } from './formatters';
import type { ITraceLogger } from './types';
import { detectCaller } from './utils';

const LEVEL_PRIORITY: Record<LoggerLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
};

/**
 * The singleton logger. One instance per process, reused across every request.
 *
 * `traceId` is the **trailing parameter of every method**, which is the design decision the whole
 * tracing story rests on. It keeps this class stateless and request-agnostic, so it is safe as a
 * singleton, and it means work that has no inbound request — a cron tick, a queue consumer — can
 * still emit correlated lines by passing an id it built itself.
 *
 * Request handlers should not call this class directly. Inject
 * {@link RequestScopedLoggerService} instead and the id is filled in for you.
 *
 * Extends `ConsoleLogger` so it can be handed to `NestFactory.create({ logger })` and pick up
 * NestJS's own framework logging in the same JSON format as everything else.
 */
@Injectable()
export class LoggerService extends ConsoleLogger implements ITraceLogger {
  private readonly config!: LoggerConfig;
  private readonly levelPriority!: number;

  constructor(@Optional() configService?: LoggerConfigService) {
    super();
    // Present under DI; absent when built by createLogger(), which sets both fields directly.
    if (configService) {
      this.config = configService.config;
      this.levelPriority = LEVEL_PRIORITY[this.config.level];
    }
  }

  /** @internal Builds an instance from a raw config, with no DI container. @see createLogger */
  static createStandalone(config: LoggerConfig): LoggerService {
    const instance = Object.create(LoggerService.prototype) as LoggerService;
    Object.assign(instance, { config, levelPriority: LEVEL_PRIORITY[config.level] });
    return instance;
  }

  /*************************************************************************
   *                           PUBLIC METHODS                              *
   ************************************************************************/

  info(message: string, context?: string, traceId?: string): void {
    this.writeLog('info', 'info', message, context, traceId);
  }

  /** Alias for {@link info}. Present so NestJS's own `logger.log(...)` calls land here. */
  override log(message: string, context?: string, traceId?: string): void {
    this.writeLog('info', 'info', message, context, traceId);
  }

  override error(message: string, trace?: string, context?: string, traceId?: string): void {
    if (!this.shouldLog('error')) return;

    this.write({
      level: 'error',
      message,
      serviceName: this.config.serviceName,
      podId: this.config.podId,
      context: context ?? detectCaller(),
      traceId,
      trace,
    });
  }

  override warn(message: string, context?: string, traceId?: string): void {
    this.writeLog('warn', 'warn', message, context, traceId);
  }

  override debug(message: string, context?: string, traceId?: string): void {
    this.writeLog('debug', 'debug', message, context, traceId);
  }

  override verbose(message: string, context?: string, traceId?: string): void {
    this.writeLog('verbose', 'verbose', message, context, traceId);
  }

  /** Displays as `silly` but filters at `verbose` priority — the level request bodies land on. */
  silly(message: string, context?: string, traceId?: string): void {
    this.writeLog('verbose', 'silly', message, context, traceId);
  }

  /*************************************************************************
   *                           PRIVATE METHODS                             *
   ************************************************************************/

  private shouldLog(level: LoggerLevel): boolean {
    return LEVEL_PRIORITY[level] <= this.levelPriority;
  }

  private writeLog(
    filterLevel: LoggerLevel,
    displayLevel: string,
    message: string,
    context?: string,
    traceId?: string,
  ): void {
    if (!this.shouldLog(filterLevel)) return;

    this.write({
      level: displayLevel,
      message,
      serviceName: this.config.serviceName,
      podId: this.config.podId,
      context: context ?? detectCaller(),
      traceId,
    });
  }

  /**
   * Writes the record.
   *
   * A raw `process.stdout.write`, with no logging framework underneath. That is not minimalism for
   * its own sake — it means there is no buffer to flush, no transport to fail, and no queue that
   * can drop the line you needed. The container runtime captures stdout; the log shipper reads it
   * off the node. Nothing runs inside this process on behalf of observability.
   */
  private write(entry: LogEntry): void {
    const output =
      this.config.format === 'pretty' ? formatPretty(entry, this.config) : formatJson(entry, this.config);

    if (entry.level === 'error') process.stderr.write(output);
    else process.stdout.write(output);
  }
}
