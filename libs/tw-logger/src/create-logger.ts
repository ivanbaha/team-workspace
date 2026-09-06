import { loadLoggerConfig } from './config';
import { LoggerService } from './logger.service';

/**
 * Builds a logger before the DI container exists.
 *
 * `NestFactory.create()` needs a logger *while it is booting the container that would provide one*.
 * Without this, everything up to the first successful module resolution — including the failures
 * that stop a service from starting at all — is logged in NestJS's default format, which no log
 * query understands.
 *
 * @example
 * async function bootstrap() {
 *   const app = await NestFactory.create(AppModule, { logger: createLogger() });
 *   app.useLogger(app.get(LoggerService)); // hand over to the DI-managed instance
 * }
 *
 * Locally, `.env` has usually not been loaded this early, so the bootstrap logger may fall back to
 * defaults. In a container `process.env` is already populated, so it does not.
 */
export function createLogger(): LoggerService {
  return LoggerService.createStandalone(loadLoggerConfig());
}
