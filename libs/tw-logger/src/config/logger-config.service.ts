import { Injectable } from '@nestjs/common';
import { loadLoggerConfig } from './load-config';

import type { LoggerConfig } from './logger-config.interface';

/**
 * DI wrapper over {@link loadLoggerConfig}.
 *
 * The loader is a plain function so that `createLogger()` can build a logger before the DI
 * container exists — during `NestFactory.create`, bootstrap failures are exactly the ones you want
 * logged in the same format as everything else.
 */
@Injectable()
export class LoggerConfigService {
  readonly config: LoggerConfig = loadLoggerConfig();
}
