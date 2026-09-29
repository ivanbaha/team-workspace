# @tw/cache

The client for the workspace's **shared cache**: one cache server, every service talking to it,
each entry owned by exactly one service. Owners read through it and invalidate on write; consumers
read the owner's keys directly (a hit skips the HTTP hop to the owner entirely); background workers
use its sets and locks as a work queue that survives a pod restart.

Three roles, one client:

| Role | Service does | Cache rules |
| --- | --- | --- |
| Owner | reads through `ReadThroughService`, writes the source of truth, invalidates its own keys after every write | the only writer of its `service_*` keys — the ACL enforces it |
| Consumer | `get`s the owner's key; on a miss, calls the owner over HTTP (the owner's own cache fills as a side effect) | **never writes** the owner's keys; a hit costs no internal hop |
| Operator | `addToSet` to enqueue, `acquireLock` to schedule, `popFromSet` to drain | queue writes and locks fail **closed** — work is never silently lost |

Depends on [@tw/logger](../tw-logger/README.md) for the trace-aware logging surface.

Full design rationale: [Shared Cache](../../docs/architecture/shared-cache.md). When something
misbehaves: [Debugging the Cache](../../docs/guides/debugging-the-cache.md).

---

## Setup

```bash
yarn add @tw/cache @tw/logger
```

```ts
// app.module.ts
import { CacheModule, CACHE_LOGGER } from '@tw/cache';
import { LoggerModule, LoggerService } from '@tw/logger';

@Module({
  imports: [
    LoggerModule.forRoot(),
    CacheModule.forRoot({
      url: process.env.CACHE_URL,                     // unset → in-process store (see below)
      ttlSeconds: Number(process.env.CACHE_TTL ?? 60), // seconds — the only TTL unit
      logger: { provide: CACHE_LOGGER, useExisting: LoggerService },
    }),
  ],
})
export class AppModule {}
```

Configuration is validated at registration. A TTL of `0`, a fractional TTL, a `NaN` from
`Number(process.env.CACHE_TTL)` on an unset variable, a `commandTimeoutMs` that is not a positive
integer, or a URL that is not `redis://…` throws a `CacheConfigurationError` **at boot**, with the
offending value in the message — not a service that runs for weeks caching with a TTL nobody
chose. A TTL a service reads for itself (a per-call override from its own environment) gets the
same treatment with the exported `assertTtlSeconds(value, 'NAME')`, called where the module loads.

`commandTimeoutMs` (default `250`) is the deadline for one command. It is what makes fail-open
work against a server that is connected but silent — a hung process, or a lost node whose TCP
connection nothing has closed yet. A command past its deadline fails like one sent to an
unreachable server, and three in a row mark the cache unreachable and force a reconnect.

> **`ttlSeconds: Number(process.env.CACHE_TTL)` without the `?? 60` is the trap.** With the
> variable unset, `Number(undefined)` is `NaN`, the type is satisfied, and — without this check —
> the service would boot and hand `NaN` to every `SET EX`. The `??` fallback and the boot-time
> rejection are two guards around the same mistake; keep both.

**Without `url`, the cache runs against an in-process store**: same API, same semantics — TTL
expiry, the JSON round trip, `SET NX` locks — and none of the sharing, because each process has
its own. That is the intended local default; it says so in a boot log you cannot miss, and the
health endpoint reports `store: 'memory'`. In a cluster it is a misconfiguration, which is why
the message reads as a warning rather than a note.

---

## The key registry

Keys are `{service}_{entity}_{id}` — `users-service_user_1` — and they are **built by
`cacheKey()`, never by hand**:

```ts
import { cacheKey } from '@tw/cache';

const key = cacheKey('user', ownerId); // 'users-service_user_1'
```

The registry is the single list of what may be cached. It is what makes the design hold together:

- **The ACL works on the service prefix.** A service's cache user is granted its own
  `~<service>_*` for writing and, for reading only, the entities it consumes
  (`~users-service_user_*`). A hand-built key with one character of drift is a key the owner
  never invalidates — or a key the ACL silently refuses.
- **Identifiers are validated, never rewritten.** A key must be a function of exactly what the
  loader behind it sees. A builder that trimmed or lowercased would give `' 1'` the key of `'1'`
  (and `Widgets` the key of `widgets`) while their loaders — matching the raw value against the
  source of truth — disagree about the answer, and whichever filled the key first would answer for
  both: one request for `/v1/users/%201` would cache "does not exist" under user 1's key, for every
  service that reads it. So an identifier that is not already canonical cannot form a key at all,
  and its request is served from the source, uncached.
- **Type confusion is refused, not mangled.** An entity object reaching the builder throws, rather
  than producing `users-service_user_[object Object]` — a key nobody else will ever compute.

Which variant to reach for depends on where the identifier came from:

- **`cacheKey(name, id)`** — for identifiers the code itself constructs. Un-keyable input is a
  bug; it throws loudly.
- **`cacheKeyOrNull(name, id)`** — for identifiers that come from data: path params and query
  values, and equally stored columns and connector data, on reads and on invalidations alike.
  Un-keyable input reads as `null`. On a read, the call site falls back to an uncached source
  read — `GET /v1/users/foo%20bar` gets its 404 from the store instead of a 500 from the cache
  layer. On an invalidation, `null` means there is nothing to delete: that value never had an
  entry. Throwing there would turn a write the source of truth already committed into a 500. An
  unknown *namespace* still throws either way: that is programmer error, not data, and degrading
  it would hide version skew behind cold metrics.

`CACHE_IDENTIFIER_PATTERN` is exported so a value that is going to become a key — a queued
category id, say — can be validated at the API boundary with the builder's own rule.

A new namespace is added to `CACHE_NAMESPACES` **in the same change as the code that first uses
it**, along with the ACL pattern for its prefix.

---

## Owner: read-through, and the invalidation contract

```ts
import { ReadThroughService, cacheKeyOrNull } from '@tw/cache';

async findOne(id: string, noCache: boolean): Promise<PublicUser | null> {
  const key = cacheKeyOrNull('user', id);          // null for ' 1', 'foo bar' — served uncached
  const load = async () => findUserInStore(id);    // return null for "does not exist"; throw for failure
  return key ? this.readThrough.readThrough({ key, load, noCache }) : load();
}
```

What `readThrough` does for you:

- **Negative caching.** A `load` returning `null` stores the `not_present` sentinel for a short
  TTL — "user 9 does not exist" is answered once per negative TTL, not once per request. Because
  `null` already means "no entry", a negative result needs a value that survives the round trip;
  a namespace whose legitimate values can equal `'not_present'` must not use negative caching.
- **Single-flight.** Concurrent misses for one key share one `load` — the per-key in-flight map
  is what keeps a cold key from fanning out into N identical source queries. It is per process:
  with N replicas, a cold key can still cost N loads.
- **`noCache` = bypass + refresh.** The cached read is skipped, the source is loaded, and the
  entry is **overwritten** with what came back. The header is a repair tool; a bypass that
  leaves the stale entry in place re-serves it to the next reader. A `noCache` read never joins
  a load already in flight — that load may have read the source before the write the caller wants
  to see — and the load it supersedes no longer writes the entry, so it cannot land on top of
  the repair.

Invalidation is the other half of the owner's contract, and it is deliberately boring:

```ts
update(id: string, changes: UpdateUserDto): PublicUser {
  const updated = updateUserInStore(id, changes);
  this.invalidateUser(id);
  return updated;
}

private invalidateUser(id: string): void {
  setImmediate(() => {
    const key = cacheKeyOrNull('user', id);   // built after the response: never a 500 for a committed write
    if (!key) return;                         // never keyable → never cached → nothing to delete
    void this.cache.del(key).then((removed) => this.logger.debug(`Invalidation removed ${removed} entry for user ${id}`));
  });
}
```

- **A write always invalidates — never gated on the request's `Cache-Control`.** The header is
  about what *this caller* may read; the write is about what *everyone* will read.
- **Every write path invalidates** — which in practice means every write goes through the owner's
  write methods. A second module writing the same store directly (a registration endpoint, a
  batch job, a migration) is a write the cache never hears about.
- **The `del` count is logged, at debug, every time — as a debugging aid.** After a read that
  filled the key, a `del` that removed nothing means the invalidation was built with a different
  key than the read — the bug that caches correctly and serves stale data until the TTL. On its
  own, `0` is also what an uncached key gives (most writes), and what a dropped invalidation gives
  while the server is unreachable (the service logs that at debug too). Key drift is prevented by
  construction — one registry, one builder — and caught by a test, not by reading counts.
- **`setImmediate`** takes the invalidation off the response path: the caller is not waiting on
  the cache, and a cache write cannot fail the request that caused it.
- **Bulk invalidation goes first** (`delMany`, one round trip) — invalidate everything the write
  touched *before* any network calls the same code makes, so no code ordering can re-introduce
  the stale entry after the invalidation ran.

What an invalidation cannot do is beat a read that loaded the source *before* the write and
stores its value *after* the `DEL` — on another replica, say. That fill is stale until its TTL.
Writes make an entry fresh in the common case; **the TTL is what bounds the worst case**, on
every rung.

Where does `noCache` come from? The controller, as a method parameter — never request-scoped DI:

```ts
@Get(':id')
findOne(@Param('id') id: string, @Headers('cache-control') cacheControl?: string) {
  return this.users.findOne(id, wantsFreshData(cacheControl));
}
```

Forwarding `cache-control` from the caller is part of the workspace's HTTP contract, handled by
[`@tw/http-connector`'s default forward list](../tw-http-connector/README.md) — a client that
sends `no-cache` gets fresh data from every service in the chain, or the header is decorative.

## Consumer: read the owner's key, never write it

```ts
async findOwner(ownerId: string, noCache: boolean): Promise<PublicUser | null> {
  const key = cacheKeyOrNull('user', ownerId);   // the id is data: un-keyable means "ask the owner"
  if (key && !noCache) {
    const cached = await this.cache.get<PublicUser>(key);
    if (cached !== null) return cached;          // the owner's entry, read directly — no HTTP hop
  }
  return this.http.findOwner(ownerId, noCache);  // miss → the owner answers, and fills its own cache
}
```

A consumer **never writes the owner's keys** — not to fill them, not to refresh them. Only the
owner knows what a fresh value is, and the ACL denies the write anyway. On a miss the consumer
calls the owner over HTTP; the owner's read-through populates the entry as a side effect, and the
next consumer read is a hit. `noCache` is threaded to the owner, which is where the bypass+refresh
actually happens.

## Operator: the set-and-lock work queue

```ts
await this.cache.addToSet('products-sync-service_queue', 'widgets');   // throws if the cache is down
if (await this.cache.acquireLock('products-sync-service_batch-lock', LOCK_TTL_SECONDS)) {
  setTimeout(() => this.drain(), BATCH_DELAY_SECONDS * 1000);
}
// …and at the end of drain(): del(lock), then re-check getSizeOfSet() and schedule again if needed.
```

The set is the queue (Redis `SADD`/`SPOP` — atomic, deduping, shared by every replica); the lock
(`SET NX EX`, atomic at the server) is what keeps two replicas from double-scheduling the same
drain. Three things keep every accepted id drained:

- **The drain releases the lock and looks again.** The lock outlives the timer on purpose — it
  collapses a burst into one drain — so a request that lands after the drain's last `SPOP` finds
  it held and arms nothing. Deleting the lock and re-checking the set when the drain finishes
  gives that work its own drain.
- **Reconciliation runs on an interval, not once at startup.** At boot the client is still
  connecting and the queue reads as empty; a crashed lock holder, a cache outage or an evicted lock
  can all leave work with nothing scheduled. A periodic `getSizeOfSet` + `acquireLock` finds it.
- **The queue is capped where work enters it.** The set carries no TTL, so it is never evicted —
  which also means it must never grow without bound, or it pushes every other entry out of the
  shared server first.

The set survives a restart of the worker, not of the cache server: persistence is off, so a
cache restart drops the queue, and re-POSTing is the recovery.

The delay is written once, in one unit, derived once: `setTimeout(..., BATCH_DELAY_SECONDS * 1000)`.
A delay in two places with a `* 1000` in one of them is how a "5 second" batch runs in 5
milliseconds.

## Composites: request keys, local invalidation plus a short TTL

An entity key names a thing; a request key names a *question* — a whole handler's answer, cached
as one value. `requestKey()` builds it from the registry, like `cacheKey()`, but the id is a route
plus query parameters, and the whole failure mode of request caching is that the same question can
be *spelled* several ways:

```ts
const key = requestKey('productCatalog', 'v1-products', { expandOwner: true });
// products-service_req_v1-products_expandowner=true

const answer = await this.readThrough.readThrough({
  key,
  load: () => this.loadTheHardWay(noCache), // list + owner hydration; no-cache reaches the parts too
  ttlSeconds: REQUEST_CACHE_TTL,            // ~10 — bounds what no local write can invalidate
  noCache,                                  // a caller's no-cache still repairs the entry
  traceId: this.logger.traceId,
});
```

The serialization is **canonical or it throws**: parameters are sorted by name, the route and the
parameter names — both written by code — are trimmed and lowercased, and parameter **values are
validated as given**, never rewritten: a value is what the loader filters on, so lowercasing
`Widgets` would hand it the key of `widgets` while its loader returns a different list. Values are
limited to what survives `/^[a-z0-9][a-z0-9._-]*$/`, which also refuses free text on purpose:
**a key space nobody can enumerate is a key space nobody can invalidate**, and an endpoint whose
parameters are free text (`?search=…`) is an endpoint that does not get request caching. Two call
sites building the same filters in different orders still produce one key — otherwise the cache
quietly holds duplicates that expire independently, and a stale twin survives the refresh of its
sibling.

The TTL is not a refinement of the request cache — it is the invalidation for the part of the
answer no writer can reach. A composite spans owners (a product list joined with users-service's
owner entries): the *naming* service invalidates the composite when its own data changes (the
key is deterministic, so the write site can build the same string the read site did), but nobody
can invalidate the other owner's contribution to the cached value. The design does not pretend
otherwise: the writer kills what it can name, the clock bounds the rest, and the entry
self-heals. A caller's `no-cache` bypasses the composite **and** the entries it is built from —
otherwise a "fresh" rebuild would reuse a part that outlived its own invalidation. Never cache a
response whose body varies by *who* is asking — that key would need an identity segment, at which
point it is an entity cache with extra steps.

---

## The failure policy

Everything above runs against infrastructure that can vanish — or stop answering while its
connection still looks open. The policy per operation, when the server is unreachable or a
command outlives `commandTimeoutMs`:

| Operation | Behaviour | Reasoning |
| --- | --- | --- |
| `get` | `null` — indistinguishable from a miss | The source of truth still answers; a dead cache must not take requests with it. |
| `set`, `del`, `delMany` | dropped (a `warn` is logged; a `debug` line for an invalidation dropped during an outage) | A cache write is an optimisation, never a commitment. |
| `addToSet` | **throws `CacheUnavailableError`** | Queue write — acknowledging unstored work loses it; callers map this to 503. A timed-out add may still have landed, so the client is told to retry, which is safe: set adds are idempotent. |
| `popFromSet`, `getSizeOfSet` | empty / zero | A batch cannot run without the lock anyway, which fails closed. |
| `acquireLock` | `false` | Without the server, "is the lock free?" cannot be answered; `true` is how two replicas both run the work. |

Three timeouts in a row with nothing succeeding in between mark the cache unreachable and force a
reconnect: a silent server emits no connection event, and without that step every request would
wait out its own timeout. Commands in flight when a connection drops are failed, not re-sent after
the reconnect (`autoResendUnfulfilledCommands: false`) — a re-sent `SET` is a fill that lands after
whatever invalidation happened in between.

One rule underlies the table: **the cache fails open when the cache is broken, and loud when the
caller is wrong.** Infrastructure failures never take a request down; invalid arguments (a TTL of
zero) throw. The distinction is not philosophical — a queue write failing open loses work, and a
caller bug failing open caches under a TTL nobody chose.

All of it is observable, because a cache nobody can see is a cache nobody trusts:

```ts
// health.controller.ts
@Get()
check() {
  return { status: 'ok', service: SERVICE_NAME, cache: this.cache.stats };
}
```

`stats` reports the store actually in use (`memory` vs `redis`), whether the cache is currently
disabled, and the hit/miss/skipped counters — `skipped` counted apart from misses so a health
check can tell a cold cache from a dead one. The state comes from the client's connection events
(`ready` → up, `error`/`close`/`end` → down) and from the timeout rule above, logged once per
transition with the retries at debug, so a restarting cache pod is one warn, not fifty — and a
service shutting down does not report its own disconnect as an outage.

---

## Testing code that uses the cache

`src/test/cache.fake.ts` ships a stateful `CacheFake`: the real behaviour — JSON serialised on
write and parsed on every read, TTL expiry, set dedup, `SET NX` locks, the outage policy — against
an in-process store, constructible
with `new CacheFake()` in any test. It is an independent reimplementation on purpose, and
`cache.fake.spec.ts` runs one behavioural suite against both it and the real `CacheService`, so
the fake cannot silently drift from the thing it stands in for. A mock that always returns `null`
"passes" every test and proves nothing; this one can produce a real hit.

---

## Scope

This library covers the client: key building, read-through, the failure policy, the queue and lock
primitives. It deliberately does **not** do:

- **Per-pod fallback caching.** When the shared cache is unreachable, reads go to the source —
  never to a per-pod in-memory copy. A fallback cache is a second cache with its own staleness
  and no owner invalidating it; the outage policy makes it unnecessary.
- **Pub/sub invalidation.** Ownership replaces it: exactly one service writes a key, and that
  service invalidates on write. Adding a broadcast would add a second, racy source of truth about
  which entries are stale.
- **Caching values the source of truth never produced.** `set` and `readThrough` store what a
  load just read or computed — an entity, a bounded list, a composite. Reconstructing an entity
  from a request body and caching it is how a cache comes to hold data the source never had.
- **Client-side TTL jitter, mget batching, key scanning.** None of those have a demonstrated cost
  in this workspace yet; the API leaves room to add them without breaking callers.