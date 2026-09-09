import { HC_LOGGER } from './constants';
import { HttpConnectionModule } from './http-connection.module';
import { HttpConnectionOptions } from './types';

import type { IHttpConnectionOptions } from './types';

const logger = { provide: HC_LOGGER, useValue: {} } as unknown as IHttpConnectionOptions['logger'];

/** Reads back the options the module actually resolved, as the connector will see them. */
function resolvedOptions(options: IHttpConnectionOptions): HttpConnectionOptions {
  const providers = HttpConnectionModule.forRoot(options).providers ?? [];
  const provider = providers.find(
    (candidate) => typeof candidate === 'object' && 'provide' in candidate && candidate.provide === HttpConnectionOptions,
  );
  return (provider as { useValue: HttpConnectionOptions }).useValue;
}

describe('HttpConnectionModule.forRoot', () => {
  it('registers with a service identity', () => {
    expect(resolvedOptions({ userAgent: 'orders-service', logger }).userAgent).toBe('orders-service');
  });

  // The realistic failure: `userAgent: process.env.DEPLOYMENT_NAME` in a deployment that does not
  // set the variable. Well-typed at compile time, undefined at runtime. Left unchecked the service
  // boots, ships `User-Agent: "undefined"`, and quietly orphans every edge it contributes.
  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['not a string', 123],
  ])('refuses to boot when the identity is %s', (_case, userAgent) => {
    expect(() => resolvedOptions({ userAgent, logger } as unknown as IHttpConnectionOptions)).toThrow(/userAgent/);
  });

  it.each([['user-agent'], ['User-Agent'], ['x-trace-id']])(
    'refuses to forward %s, which has its own dedicated path',
    (header) => {
      expect(() => resolvedOptions({ userAgent: 'orders-service', forwardHeaders: [header], logger })).toThrow(
        /cannot forward/,
      );
    },
  );

  it('still accepts an ordinary forward list', () => {
    const options = resolvedOptions({
      userAgent: 'orders-service',
      forwardHeaders: ['accept-language', 'authorization'],
      logger,
    });

    expect(options.forwardHeaders).toEqual(['accept-language', 'authorization']);
  });
});
