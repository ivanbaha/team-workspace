import { LoggerService } from './logger.service';

import type { LoggerConfig } from './config';

const BASE_CONFIG: LoggerConfig = {
  serviceName: 'orders-service',
  podId: 'b4799cf77-8t452',
  level: 'verbose',
  format: 'json',
  requestLogging: 'compact',
};

function captureStdout(fn: () => void): string {
  const written: string[] = [];
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    written.push(String(chunk));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return written.join('');
}

function captureStderr(fn: () => void): string {
  const written: string[] = [];
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    written.push(String(chunk));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return written.join('');
}

describe('LoggerService', () => {
  it('writes exactly one JSON line per record', () => {
    const logger = LoggerService.createStandalone(BASE_CONFIG);

    const output = captureStdout(() => logger.info('hello', 'Ctx', 'TRACE1'));

    expect(output.endsWith('\n')).toBe(true);
    // A record split across lines would be shipped as unrelated entries.
    expect(output.trimEnd().split('\n')).toHaveLength(1);
  });

  it('keeps the documented field order', () => {
    const logger = LoggerService.createStandalone(BASE_CONFIG);

    const output = captureStdout(() => logger.info('hello', 'Ctx', 'TRACE1'));
    const keys = Object.keys(JSON.parse(output));

    expect(keys).toEqual(['timestamp', 'level', 'serviceName', 'podId', 'context', 'traceId', 'message']);
  });

  it('omits traceId entirely when there is none, rather than emitting null', () => {
    const logger = LoggerService.createStandalone(BASE_CONFIG);

    const output = captureStdout(() => logger.info('no trace here', 'Ctx'));
    const record = JSON.parse(output);

    // `"traceId": null` would match every untraced line in a substring search.
    expect(record).not.toHaveProperty('traceId');
  });

  it('carries the trace id through every level', () => {
    const logger = LoggerService.createStandalone(BASE_CONFIG);

    for (const level of ['info', 'log', 'warn', 'debug', 'verbose', 'silly'] as const) {
      const output = captureStdout(() => logger[level]('message', 'Ctx', 'TRACE1'));
      expect(JSON.parse(output).traceId).toBe('TRACE1');
    }

    const errorOutput = captureStderr(() => logger.error('boom', 'stack', 'Ctx', 'TRACE1'));
    expect(JSON.parse(errorOutput).traceId).toBe('TRACE1');
  });

  it('sends errors to stderr and everything else to stdout', () => {
    const logger = LoggerService.createStandalone(BASE_CONFIG);

    expect(captureStderr(() => logger.error('boom', undefined, 'Ctx'))).toContain('boom');
    expect(captureStdout(() => logger.info('fine', 'Ctx'))).toContain('fine');
  });

  it('reports silly as its own display level while filtering at verbose priority', () => {
    const verbose = LoggerService.createStandalone(BASE_CONFIG);
    expect(JSON.parse(captureStdout(() => verbose.silly('x', 'Ctx'))).level).toBe('verbose');

    const info = LoggerService.createStandalone({ ...BASE_CONFIG, level: 'info' });
    expect(captureStdout(() => info.silly('x', 'Ctx'))).toBe('');
  });

  it('drops records below the configured level', () => {
    const logger = LoggerService.createStandalone({ ...BASE_CONFIG, level: 'warn' });

    expect(captureStdout(() => logger.info('dropped', 'Ctx'))).toBe('');
    expect(captureStdout(() => logger.warn('kept', 'Ctx'))).toContain('kept');
  });
});
