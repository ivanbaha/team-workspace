import { CacheService, NEGATIVE_CACHE_SENTINEL, ReadThroughService } from '@tw/cache';
import { AuthService } from '../auth/auth.service';
import { UsersService } from './users.service';

import type { CacheOptions } from '@tw/cache';
import type { RequestScopedLoggerService } from '@tw/logger';

// Real cache client over its in-process store: the behaviour under test is what lands in the
// cache, so a mock that answers whatever it was told would prove nothing here.
function wire() {
  jest.resetModules();
  const logger = { traceId: 'test', info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  const options = { ttlSeconds: 60, negativeTtlSeconds: 30, commandTimeoutMs: 250 } as CacheOptions;
  const cache = new CacheService(options, logger as never);
  const readThrough = new ReadThroughService(cache, options, logger as never);

  // Fresh module registry per test → a fresh in-memory users store and id sequence.
  const { UsersService: Users } = jest.requireActual<{ UsersService: typeof UsersService }>('./users.service');
  const { AuthService: Auth } = jest.requireActual<{ AuthService: typeof AuthService }>('../auth/auth.service');
  const users = new Users(logger as unknown as RequestScopedLoggerService, cache, readThrough);
  const auth = new Auth(logger as unknown as RequestScopedLoggerService, users);
  return { cache, users, auth };
}

/** Lets the deferred invalidation (setImmediate) and its DEL run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('UsersService — the user cache entries it owns', () => {
  it('does not let a non-canonical spelling of an id write the canonical id’s entry', async () => {
    const { users, cache } = wire();
    await users.findOne('1', false); // warm user 1

    // GET /v1/users/%201 with Cache-Control: no-cache — before the fix, this stored "not_present"
    // under user 1's key, and every service reading it answered 404 for Alice.
    await expect(users.findOne(' 1', true)).rejects.toThrow(/not found/i);

    await expect(users.findOne('1', false)).resolves.toMatchObject({ id: '1', name: 'Alice' });
    expect(await cache.get('users-service_user_1')).toMatchObject({ id: '1' });
  });

  it('does not cache a 404 under the canonical key from a cold read of a padded id either', async () => {
    const { users, cache } = wire();

    await expect(users.findOne('1 ', false)).rejects.toThrow(/not found/i);

    expect(await cache.get('users-service_user_1')).not.toBe(NEGATIVE_CACHE_SENTINEL);
    await expect(users.findOne('1', false)).resolves.toMatchObject({ id: '1' });
  });

  it('clears a cached 404 for the id a registration creates', async () => {
    const { users, auth, cache } = wire();
    await expect(users.findOne('3', false)).rejects.toThrow(/not found/i); // "3 does not exist", cached
    expect(await cache.get('users-service_user_3')).toBe(NEGATIVE_CACHE_SENTINEL);

    const carol = auth.register({ name: 'Carol', email: 'carol@example.com' });
    await flush();

    expect(carol.id).toBe('3');
    await expect(users.findOne('3', false)).resolves.toMatchObject({ id: '3', name: 'Carol' });
  });

  it('never hands a deleted user’s id to the next registration', async () => {
    const { users, auth } = wire();

    users.remove('2');
    const created = auth.register({ name: 'Dan', email: 'dan@example.com' });

    expect(created.id).toBe('3');
  });

  it('invalidates the entry on update, so the next read sees the change', async () => {
    const { users } = wire();
    await users.findOne('1', false);

    users.update('1', { name: 'Alicia' });
    await flush();

    await expect(users.findOne('1', false)).resolves.toMatchObject({ name: 'Alicia' });
  });
});
