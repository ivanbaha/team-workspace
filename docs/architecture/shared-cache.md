# Shared Cache

How a dozen services share one cache without sharing each other's data, each other's failures,
or each other's bugs.

---

## The one-paragraph version

Every service talks to one cache server. Every cached entity has exactly one writer — the
service that owns the entity — and its key says who that is: `users-service_user_1` is a user,
owned by users-service, and the prefix is the ownership contract. Consumers read the owner's
entries directly, so a hit costs one cache round trip instead of one HTTP hop to the owner.
The owner invalidates on every write, unconditionally. Reads fail open when the cache is down;
queue writes fail closed; invalid arguments throw — the failure policy is per operation, and it
is the library's, not each service's. Background work runs *on* the cache rather than against
it: a Redis Set is the work queue, `SET NX EX` is the batch lock, and the same server that
holds the entries holds the work that refreshes them.

The application-side implementation is one library (`@tw/cache`), one module import per service,
and a cache server whose entire behaviour is three flags and an ACL file. There is no cache
annotation, no per-pod cache tier, no pub/sub invalidation bus, and no framework integration to
configure.

Reads are cached at three rungs — one entity, a bounded list, a composite request — and the rungs
differ in exactly one thing: the invalidation each can honestly claim. An entity entry is
invalidated by its owner's write; a list is invalidated wholesale by the same write; a composite
is invalidated by whichever writer can *name its key* — its own owner — and bounded by the clock
for the contributions no writer can reach. That ladder — and the discipline of picking the
lowest rung that answers the need — is the part of this design worth carrying somewhere else.

That is the whole architecture. The [work queue](#the-operator--the-work-queue-and-the-batch-lock)
at the end is a consequence of the same primitives, not a second system.

> **This describes an approach, not a drop-in.** What is worth copying is the decisions in
> [Applying this to other stacks](#applying-this-to-other-stacks) — not our specific values.
> The traps in [Traps this design exists to avoid](#traps-this-design-exists-to-avoid) are the
> parts worth reading twice: every one of them is a real failure we either hit or caught in
> review, and each has left a specific, findable mark somewhere in this repository.

---

## Anatomy of the contract

### The key is the ownership contract

```txt
users-service_user_1
└── the owner    └── entity └── id
```

The key format is `{service}_{entity}_{id}`, and it is not a convention — it is how the whole
design enforces itself:

- **The prefix names the one service that may write the key.** The ACL on the cache server grants
  each service read-write on its own prefix and read on the prefixes it consumes — a service can
  play both roles at once (products-service owns `products-service_*` and consumes
  `users-service_*` read-only), and a bug that writes someone else's key is refused *by the
  server*, no matter what the code says.
- **The key is built by a registry, never by hand.** `CACHE_NAMESPACES` in
  `libs/tw-cache/src/cache-keys.ts` declares every `{service, entity}` pair in one place, and the
  builder derived from it is the only way a key is produced anywhere:

  ```ts
  export const CACHE_NAMESPACES = {
    user: { service: 'users-service', entity: 'user' },
    categoryStats: { service: 'products-sync-service', entity: 'categoryStats' },
  } as const;
  ```

  A hand-built `'users-service_user_' + id` in a consumer and a registry-built key in the owner
  is how two services end up addressing two different keys for the same entity, each looking
  perfectly correct, and the cache "never hits".

- **The builder validates, and never rewrites.** `cacheKey('user', id)` rejects anything that is
  not a string or a number — an object, `undefined`, a boolean — and anything that does not match
  `[a-z0-9][a-z0-9._-]*` *as given*. It does not trim or lowercase, because **a key must be a
  function of exactly what the loader behind it sees.** A builder that normalized would give
  `' 1'` the key of `'1'` while their loaders, matching the raw value against the store, disagree:
  one request for `/v1/users/%201` would cache "does not exist" under user 1's key, and every
  consumer reading that key would serve the 404. A value that is not already canonical cannot form
  a key, and its request is served from the source, uncached (`cacheKeyOrNull` reads it as `null`).

- **Synthetic shapes get a namespace no caller can reach.** The unfiltered list is the shape `all`;
  a category is the shape `category.<name>`. With a bare `<category>` shape, `?category=all` would
  have been a way to overwrite the unfiltered list's entry with an empty one.

- **The id is opaque to the cache.** `user_1` and `categoryStats_widgets` are the same shape; the
  cache never parses a key, and the registry is the only thing that knows what the parts mean.

### Exactly one writer per key

Only the owner knows what a *fresh* value is. A consumer that wrote the owner's key would be
publishing a guess about someone else's data — and the guess would outlive the truth, because
nobody invalidates what they do not own. So the rule is absolute:

- The **owner** writes entries, invalidates on every write, and serves reads through the same
  read-through path a consumer would use.
- A **consumer** never writes the owner's keys, even when a miss just cost it an HTTP hop. It
  calls the owner; the owner's read-through fills the entry; the next consumer read is a hit.
  One fill, owned by the one service that can do it correctly.
- Only **freshly computed** values are ever stored. `products-sync-service` recomputes an
  aggregate from raw products, never from another aggregate — a cache entry derived from a cache
  entry is a stale value that has been laundered into looking fresh. The batch fetches with
  `no-cache`, so its inputs are read at compute time; the on-demand read aggregates
  products-service's list read, which that owner invalidates on every product write — as fresh as
  any owner read, and bounded by the list's TTL in the worst case.
- **Every write path goes through the owner's write methods.** Invalidation is only as complete as
  the paths that remember it: a registration endpoint in another module, a batch job or a migration
  writing the store directly is a write the cache never hears about.

### The failure policy, per operation

The heart of the design, because a cache's failure modes are *silent* by default — every one of
these rows is a decision, not an accident:

| Operation | Server unreachable, or not answering in time | Why |
| --- | --- | --- |
| `get` | `null`, indistinguishable from a miss | The source of truth still answers; a cache outage must not take requests down. The `skipped` counter on `/health` is what tells you it is happening |
| `set` / `del` / `delMany` | dropped | A cache write is an optimisation, never a commitment. Dropping one is the correct response to a broken cache |
| `addToSet` | **throws** `CacheUnavailableError` | Set adds are queue writes. Reporting "accepted" for work that may not have been stored loses work — the controller maps this to `503` and asks for a retry, which is safe because set adds are idempotent |
| `acquireLock` | `false` | Without the server there is no way to know the lock is free; "not acquired" is the only safe answer |
| invalid arguments, bad TTLs | **throws** `CacheConfigurationError` at boot or at call | Programmer error. Failing open *here* would hide the mistake behind plausible-looking behaviour |

One sentence governs the whole table: **the cache fails open when the cache is broken, and loud
when the caller is wrong.** "Broken" includes slow.

Reachability comes from the client's own connection events (`ready`, `error`, `close`, `end`), so
a full cache outage costs each service a handful of log lines, not a stream of errors. But a
server can also be connected and silent — a hung process, or a lost node whose TCP connection
nothing has closed yet — and that emits no event at all. So every command has a deadline
(`commandTimeoutMs`, 250 ms by default): a command past it fails like one sent to an unreachable
server, and three in a row mark the cache unreachable and force a reconnect, so requests stop
paying the timeout one by one. Without the deadline, fail-open is only as fast as the kernel
giving up on a dead socket — minutes.

The client is created with `enableOfflineQueue: false`: a command issued while disconnected
rejects immediately instead of queueing invisibly behind a reconnect. Commands already in flight
when a connection drops are failed, not re-sent after the reconnect
(`autoResendUnfulfilledCommands: false`) — a re-sent `SET` is a fill that lands after whatever
invalidation happened in between.

### Freshness: `Cache-Control: no-cache`

A caller who suspects a stale entry says so once, in the header every HTTP stack already has:

```txt
Cache-Control: no-cache
```

The semantics are **bypass and refresh** — the service skips the cached read, loads from the
source of truth, and overwrites the entry, so the demand *repairs* the cache for every following
reader, not just the caller who asked. A bypass that left the stale entry in place would re-serve
it to the very next reader, and the person who sent the header would conclude it does nothing.
A `no-cache` read never joins a load already in flight: that load may have read the source
before the write the caller wants to see. It starts its own, and the load it supersedes no longer
writes the entry.

This borrows a request directive RFC 9111 defines for HTTP caches and applies it to the caches
behind the origin, and that makes it an amplification lever: browsers send `no-cache` on every
hard reload and whenever devtools disables caching. **Who may send it is an edge decision** —
strip it from public traffic at the gateway or rate-limit it, and keep it for internal callers,
batch jobs and operators, for whom it is the repair tool.

Three structural decisions make the demand work at all:

1. **It travels.** `@tw/http-connector` forwards `cache-control` by default, like
   `accept-language`, so the demand survives every hop and reaches the owner — which is where the
   bypass-and-refresh actually happens.
2. **It is read in the controller signature, not threaded through DI.** The header arrives as a
   method parameter (`@Headers('cache-control') cacheControl?: string` → `wantsFreshData(...)`),
   visible in every handler that honours it. Bubbling it through request-scoped providers makes
   the freshness behaviour invisible global state.
3. **Writes never read it.** Invalidation after a write is unconditional — a caller does not get
   to leave the next reader a stale entry by omitting a header.

---

## The flow, end to end

### The consumer's read

`products-service` resolving a product's owner — the hop the cache exists to eliminate:

```mermaid
sequenceDiagram
    autonumber
    participant C as caller
    participant P as products-service (consumer)
    participant K as shared cache
    participant U as users-service (owner)

    C->>P: GET /v1/products/1?expandOwner=true
    P->>K: GET users-service_user_1
    alt hit (or negative entry)
        K-->>P: the user — or "not_present"
        Note over P: no HTTP hop, no trace fan-out
    else miss
        P->>U: GET /v1/users/1 (x-trace-id forwarded)
        Note over U: owner's readThrough: miss → store
        U-->>P: the user
        U->>K: SET users-service_user_1 (TTL 60s)
    end
    P-->>C: the product with its owner
```

Two things in that flow are easy to miss:

- **A hit is not "the same answer, faster" — it is a shorter trace.** The call to users-service
  never happens: no `request.out`/`response.in` pair, no fan-out under the caller's trace id, one
  round trip to the cache instead of one to a peer. The economic argument for consumers reading
  the owner's keys directly is *hops removed*, not just latency.
- **Negative entries are part of the contract.** A user the owner has proven absent is stored as
  the sentinel `"not_present"` for a short TTL, and the consumer's read honours it. Without that,
  "this owner does not exist" is an HTTP call on every single request — a miss for a *missing
  thing* is still a miss. The sentinel is a constant in the library, not a magic string per
  service.

### The owner's write

```ts
// users-service, after the store write:
private invalidateUser(id: string): void {
  const key = cacheKey('user', id);
  setImmediate(() => {
    void this.cache.del(key).then((removed) => {
      this.logger.debug(`Invalidation removed ${removed} cache entry for user ${id} (key ${key})`);
    });
  });
}
```

Every decision in those lines is one of the traps from the section below: the invalidation is
**unconditional** (never gated on a header), it runs **off the response path** (`setImmediate` —
the caller's write is not held hostage to a cache round trip, and the key is built there, so no
key can turn a committed write into a 500), and **the delete count is logged every time**. The
count is a debugging aid, not an alarm: after a read that filled the key, `removed 0` means the
invalidation was built with a different key than the read. On its own, `0` is also what every
write to an uncached key gives, and what a dropped invalidation gives while the cache is
unreachable (the client logs those at debug) — so key drift is prevented by construction, one
registry and one builder, and caught by tests.

**How stale can an entry get?** Usually not at all: the owner's write deletes it and the next
read refills it. Three things can leave an old value in place anyway, and the design names the
bound for each rather than pretending they do not happen:

- **The deferred `DEL`.** A client that writes and re-reads within the same moment can land its
  GET before the `setImmediate` delete — the change looks reverted for one moment.
- **A dropped `DEL`.** A delete is best-effort: during a blip in the connection it is dropped,
  and if the cache comes back without restarting, the old entry is still there.
- **A stale fill.** A read that loaded the source *before* the write commits can store its value
  *after* the write's `DEL` — on another replica, the common case, nothing in-process can see it.
  That entry then looks perfectly valid.

In all three, **the entry's TTL is the bound**: 60 s for entities and lists, 30 s for negative
entries. Single-writer ownership removes the coordination problem between services; it does not
remove this race inside the owner. Closing it takes versioned or leased fills (the
lease mechanism in *Scaling Memcache at Facebook*, NSDI 2013) — work this design leaves to the
day the TTL is not a good enough bound. The client that must read its own write sends
`Cache-Control: no-cache`: its read starts a fresh load (it never joins one already in flight),
and on the owner's own pod the older load it superseded no longer writes the entry.

### The list — cached whole, invalidated wholesale

A list has two ways to be stale — *membership* (which items it contains) and *content* (what each
item says) — and most list-caching designs fail by treating them differently. This design treats
them the same, deliberately: **any write to any product kills every cached list shape.**

```ts
// products-service, after any create/update/remove:
private invalidateAfterWrite(productId: string, extraCategories: string[] = []): void {
  setImmediate(() => {
    const keys = [...this.listKeys(extraCategories), cacheKeyOrNull('product', productId)].filter(Boolean);
    void this.cache.delMany(keys).then((removed) => { /* log the count */ });
  });
}
```

`GET /v1/products` (and `?category=`) reads the whole hydrated list as **one value** through the
same read-through as an entity — under `products-service_productList_all` or
`products-service_productList_category.<name>`. The shapes are enumerable, which is what makes the
wholesale rule implementable: one `delMany` of `all` plus one key per category, and the write's
own item key. An update that moves a category passes the *old* category explicitly, and a delete
passes the deleted product's — an emptied category is a shape the store can no longer name, and
the one a naive "scan the store" would skip. A category that cannot form a key (`Home & Garden`)
is simply never cached — its reads go to the store — so the invalidation skips it instead of
throwing after the write has committed.

Why blunt instead of clever: the "smart" alternative — invalidate membership on create/delete,
content per item, keep the list valid otherwise — buys exactly one store read avoided per write
window, and costs a set of invalidation branches that can be gotten wrong with no witness (a
stale list that nothing ever flags). The failure mode of the blunt rule is a cache miss. **The
boundary where blunt stops winning is measurable**: if writes are frequent enough that the list
hit rate lives near zero, the answer is a shorter TTL or no list cache at all — never a smarter
invalidation algorithm.

Two costs of the blunt rule scale with the data, and both belong in the decision rather than in
a surprise: the write path must **enumerate the shapes** (here a scan of an in-memory array; in a
real database a `SELECT DISTINCT` — keep the shape set cheap to enumerate, or move to a
category table), and the cached value is the **whole hydrated list** — a shape that grows into
multi-megabyte values stops being a cache shape. When a list gets big enough that its value is
measured in megabytes, paginate the store read (and enumerate the pages from the count), or
shard the shape — do not keep inflating one key.

Two details the rung teaches on its own:

- **`[]` is a valid cached value.** "No products in this category" is a fact, cached like any
  other; `null` means *proven absent* and goes through the sentinel. A list load can never return
  `null`, so the library's read-through types it that way — the non-nullable load overload — and
  the distinction survives into the code that calls it.
- **`?search=` is never cached.** Free text cannot form a key — `requestKey()` refuses it by
  construction — because a key space nobody can enumerate is one nobody can invalidate. Search
  reads the store every time; that is a decision stated in the code comment and here, not an
  omission. (If lists grow pagination, the same rule applies: paginate the store read, and either
  enumerate the pages from the store's count or don't cache pages — never guess a page range.)

### The composite — the clock is the invalidation

The most expensive read in the demo estate is `GET /v1/products?expandOwner=true`: the catalog
with every owner resolved from users-service. It is cached whole, as one value, under a
**request key**:

```ts
const key = requestKey('productCatalog', 'v1-products', { expandOwner: true });
// products-service_req_v1-products_expandowner=true

const answer = await this.readThrough.readThrough({
  key,
  load: () => this.loadTheCatalog(noCache), // list + owner hydration; no-cache reaches the parts
  ttlSeconds: REQUEST_CACHE_TTL_SECONDS,    // from REQUEST_CACHE_TTL, checked at boot
  noCache,                                  // a caller's no-cache still repairs the entry
  traceId: this.logger.traceId,
});
```

Its invalidation story has two halves, and confusing them is the mistake: **the half this service
owns is invalidated on write; the half it cannot reach is what the TTL bounds.** The composite
key is deterministic — `requestKey()` builds the same string at the write site as at the read —
so products-service's writes kill it like any local shape, and a price change is never masked by
a stale composite. What no product write can touch is the *contribution of the other owner*: the
owner entries users-service resolved into the cached answer. Users-service does not know the
composite exists. For that half, the TTL *is* the invalidation, the staleness bound is stated in
one number, and the entry self-heals on expiry.

The parts inside the composite read through their own caches. A normal recompute uses them as
they are — everything below the composite is invalidated on write, so the parts are fresh, or
stale by at most their own TTL. A caller's `no-cache` goes further: it bypasses the composite
*and* the parts, because a "fresh" rebuild from a part that outlived its invalidation would just
re-cache the value the caller was trying to get past. The owner-hydration fan-out inside a
recompute is bounded twice in normal operation: users-service's single-flight serves concurrent
asks on one pod from one load, and the composite itself recomputes at most once per TTL window.
During a cache outage neither bound holds — every part is an HTTP call — which is why the
fail-open path has to be sized for the fan-out, not for one request.

The key is built by `requestKey()`, not by hand, because the whole failure mode of request
caching is that the same question can be *spelled* several ways — parameters in a different
order, a differently cased parameter name at another call site. Two spellings must produce one
key, or the cache quietly holds duplicates that expire independently: a hit rate that reads fine
while half the traffic misses, and a stale twin that survives the refresh of its sibling. The
helper's serialization is **canonical or it throws**: sorted parameters, a normalized route and
parameter names (both written by code), and parameter **values validated as given** — a value is
what the loader filters on, so it is never rewritten, and free text is refused by design.

Three rules bound what a composite may be, and they are the difference between a request cache and
a trap:

1. **Never cache an answer whose body varies by *who* is asking.** The moment authorization or
   identity changes the response, the key would need an identity segment — at which point it is
   an entity cache with extra steps, and should be built as one. The demo's catalog is
   caller-independent, which is why it qualifies.
2. **Only successful answers are cached.** A throwing `load` stores nothing — an outage's error
   body never outlives the outage. (Free, from read-through's existing behaviour.)
3. **Each composite is opted in by naming its key in the handler.** No blanket
   cache-everything decorator, no middleware that caches every GET — those cache auth-varied,
   per-user, and error responses *by default*, which is precisely the list above.

### The operator — the work queue and the batch lock

`products-sync-service` owns the per-category aggregates (`products-sync-service_categoryStats_*`)
and refreshes them in the background, using the cache's set and lock primitives rather than a
second piece of infrastructure:

```mermaid
sequenceDiagram
    autonumber
    participant C as caller
    participant S as products-sync-service (operator)
    participant K as shared cache
    participant P as products-service

    C->>S: POST /v1/recalculations {categoryIds}
    Note over S: ids validated with the key rule; refused past MAX_QUEUE_SIZE
    S->>K: SADD products-sync-service_queue [ids]  (duplicates collapse)
    S->>K: SET products-sync-service_batch-lock (ISO timestamp) NX EX 10
    alt lock acquired
        Note over S: setTimeout(drain, BATCH_DELAY_SECONDS * 1000)
        S-->>C: 202 {queued, scheduled: true}
    else lock held
        S-->>C: 202 {queued, scheduled: false}  (a drain is armed or running)
    end
    Note over S: ... the delay window ...
    S->>K: SPOP queue 100  → ids (atomic: no two drains hand out the same id)
    S->>K: UNLINK stats keys, ONE round trip — before any network call
    loop each category
        S->>P: GET /v1/products?category=…  (no-cache; service token; derived trace id)
        S->>K: SET categoryStats_<id> (fresh aggregate, TTL 300)
    end
    S->>K: DEL batch-lock, then SCARD queue — anything left gets a drain of its own
```

The queue is a **Redis Set**: `SADD` enqueues with dedup for free (re-posting a pending id
changes nothing), `SPOP` drains *atomically* — two drains can never hand out the same category —
and the set survives a crash of the service, which is the entire reason the queue lives on the
shared cache and not in a timer.

Every accepted id has to get a drain, and three mechanisms make sure it does — each one covers a
way the obvious design loses work:

- **The drain releases the lock and looks again.** The lock is held for longer than the delay on
  purpose (it collapses a burst of requests into one drain), so a request that arrives after the
  drain's last `SPOP` finds it held and arms nothing. Without a release, that id waits for some
  later request to happen by. The drain deletes the lock when it finishes and checks the set once
  more; anything added in the meantime gets a drain of its own.
- **Reconciliation runs on an interval, not once at startup.** A one-off check at boot runs before
  the cache client has connected — an unreachable cache reports every set as empty — so it never
  sees the orphans it exists for. And a startup check does nothing for work stranded while the
  service keeps running: a lock holder that crashed before arming its timer, a cache outage that
  swallowed a schedule, an evicted lock. Every `RECONCILE_INTERVAL_SECONDS` the service counts the
  set and, if the lock is free, schedules a drain.
- **The queue is bounded where work enters it.** The set carries no TTL, so eviction never touches
  it — which also means it must never be allowed to grow without limit, or it pushes every other
  service's entries out of the shared server before the server starts refusing writes. Each id is
  validated with the key builder's own rule (at most 100 per request, 64 characters each), and the
  service answers `503 QUEUE_FULL` past `MAX_QUEUE_SIZE`.

The durability claim has two boundaries, and they should be stated rather than discovered:

- **A cache-server restart drops the queue.** Persistence is off, deliberately (a restarted cache
  must not resurrect stale entries), and the set goes with everything else. The set survives a
  restart of the *worker*, not of the *cache*. Re-POST is the recovery.
- **The in-flight window.** `SPOP` removes an id before its recomputation finishes, so a crash
  mid-drain loses the popped-but-unprocessed batch — the reconcile finds the set empty.

For this example both are the accepted trade-off (the windows are seconds wide, and the work is
re-POSTable). A queue whose loss is unacceptable should move off a cache that runs without
persistence: to Redis Streams with consumer groups (`XREADGROUP`, `XACK`, `XAUTOCLAIM` — each
entry stays pending until acknowledged) on a persistent instance, or to a real broker. A longer
`SPOP` argument or a hand-rolled `SMOVE` to a processing set (which moves one member per call)
is not the fix.

The lock is **`SET NX EX`**, atomic acquire-with-TTL. For a holder that died between acquiring
and draining, *the TTL is the release*, so a crash can never block scheduling forever. The drain's
own release is ownership-blind — if a drain outran the TTL, it may free a lock another replica
took since — and that is acceptable because the lock is a cost optimisation, not the correctness
mechanism: two drains at once simply split the set between them, because `SPOP` hands each id to
exactly one. (The lock carries a TTL, so under memory pressure `volatile-lru` may evict it early —
the same harmless early release.)

Inside the drain, three rules carry the design:

- **Invalidate first, in one round trip.** `delMany` of every stats key in the batch, before any
  recomputation. A reader arriving in the gap gets a miss and loads on demand; it can never be
  served a stale aggregate that the queue has already promised to replace. Bulk-deleting before
  the network calls also means a slow upstream cannot leave the cache serving entries that have
  been queued for replacement.
- **A failure is logged and dropped, not re-enqueued.** A re-enqueue inside the drain would be
  popped again by the same loop, and a permanently broken category would spin the batch forever.
  The error line carries the derived trace id and the upstream status; the caller re-POSTs.
- **The batch runs as itself.** Outside request scope there is no caller whose token could be
  forwarded, so the drain mints its own short-lived service JWT (`type: service`) — without it
  every batch call dies at the receiving guard, the classic "works from curl, dead in the cron".

And the batch is traceable like everything else: one new root id per run
(`{"batch":"start","runId":…}`), one id derived per category
(`<runId>-category-widgets`), so a batch reads in the logs as one family instead of N unrelated
roots — see
[Distributed Tracing § the manual fallback](./distributed-tracing.md#4-the-manual-fallback).

---

## Traps this design exists to avoid

Every row below is a real failure from the system this design came from, already fixed there and
baked in here from the first line. The "mark" column is where the fix lives, so none of this reads
as folklore:

| Trap | What it looks like when it happens | The mark the fix left |
| --- | --- | --- |
| A TTL in two units — `CACHE_TTL=60` seconds consumed as milliseconds by one call site | Entries that live 60 ms (or 60 000× too long); the cache "works", metrics just look weird | Seconds are the only TTL unit in the library; the one delay that needs milliseconds derives it once, from one constant (`BATCH_DELAY_SECONDS * 1000`) |
| Invalidating only when the caller sent `no-cache` | A write leaves the stale entry; the reader who *fixed* the data gets no benefit from the fix | Writes always invalidate — the header is never read on a write path |
| The freshness demand dying at the first hop | `cache-control` not forwarded; the owner never learns of the bypass; the header "does nothing" | `cache-control` is on the connector's default forward list; services that name an explicit list must name it too |
| Keys built by hand, casing drifting per call site | Owner and consumer address two different keys for one entity; every consumer read is a miss, every owner invalidation misses | The registry + one builder; keys are never concatenated by hand |
| A key builder that normalizes ids its loader matches raw | One request for `/v1/users/%201` caches "does not exist" under user 1's key, and every consumer serves the 404 | Identifiers are validated, never rewritten; a non-canonical spelling cannot form a key and is served uncached |
| A synthetic shape sharing a namespace with values callers supply | `?category=all` overwrites the unfiltered list's entry with `[]` | Shapes are `all` and `category.<name>` — no category can name the synthetic one |
| Passing the wrong identifier into a key builder (an object, `undefined`) | Entries keyed by `"[object Object]"`; a whole class of data never hits | `cacheKey()` rejects anything but string/number, and validates the shape |
| A throwing key builder on a write path, after the commit | A value the DTO allowed (`Home & Garden`) commits, answers 500, and blocks the invalidation of every later write | Invalidation builds keys with `cacheKeyOrNull`, after the response; a shape that cannot form a key has no entry to delete |
| Treating `DEL` as fire-and-forget | A dead invalidation has no witness — the log says nothing, the entry stays, nothing anywhere is wrong | `del` returns the count and it is logged every time — a debugging aid, meaningful after a read that filled the key; drift itself is prevented by the one builder |
| Invalidating a batch one key at a time, interleaved with network calls | A long window of stale reads; N round trips; a slow upstream stretches the window | `delMany` first, one `DEL`, before any recomputation |
| One shared cache credential with `+@all` | Any service's bug can `FLUSHALL` every other service's entries | Per-service ACL users scoped to a key pattern; `-@dangerous`; `default off` |
| `SET` then `EXPIRE` as a lock (two steps) | A crash between them leaves a lock that never releases; the queue stalls forever | `SET NX EX` is atomic; the TTL *is* the release, and there is no unlock call to get wrong |
| The queue as an in-memory list plus a timer | A restart silently loses every accepted item; the `202` already went out | The set lives on the shared cache — it survives the worker's restart, not the cache's |
| A lock that outlives its drain, released only by its TTL | Work accepted after the drain's last pop answers `202 {scheduled:false}` and never runs | The drain deletes the lock when it finishes and re-checks the set |
| Reconciling orphans once, at startup | The check runs before the cache client has connected, reads the queue as empty, and never looks again | A reconcile pass every `RECONCILE_INTERVAL_SECONDS` |
| An un-evictable queue with no bound | A flood of ids evicts every service's entries first, then the server refuses writes | Ids validated with the key rule, at most 100 per request; `503 QUEUE_FULL` past `MAX_QUEUE_SIZE` |
| Accepting work while the queue backend is down | `202 Accepted` for work that was never stored — the caller never retries | `addToSet` throws when the add is not confirmed; the endpoint answers `503 CACHE_UNAVAILABLE` and asks for a retry (safe — the set deduplicates) |
| Fail-open driven only by connection events | A connected-but-silent server holds every request that reads the cache, while `/health` reports all is well | A deadline on every command (`commandTimeoutMs`); three timeouts in a row mark the cache unreachable and reconnect |
| A `no-cache` read joining a load already in flight | The client that wrote and re-read gets the pre-write value, and the older load then overwrites the repair | A `no-cache` read starts its own load; the load it supersedes does not write the entry |
| A rolling update of a single cache instance | For the overlap, two unrelated caches sit behind one Service — invalidations and queued work land on the one about to stop | `strategy: Recreate` |
| Background jobs borrowing nobody's credentials | Everything works from curl; the cron's calls all die 401 | The drain mints a service token of its own, once per run |
| A per-pod in-memory fallback "so it always works" | N pods = N caches that never share; a broken shared cache becomes invisible, and the data disagrees between neighbours | The only fallback is the library's in-process store, which **logs a loud warning** and reports `store: "memory"` on `/health` |
| A memory store with its own value semantics | Tests pass while the real store serialises differently — `Date` becomes an object here, a string there; `undefined` vanishes; a caller that mutates what it read changes the cache | The memory store serialises on write and parses on every read, exactly what the real store does |
| A test fake that can drift from the real client | The suite stays green while behaviour diverges; the bug ships with passing tests | `CacheFake` is an independent reimplementation, and `cache.fake.spec.ts` runs one behavioural suite against **both** implementations |
| Persistence enabled on the cache | A restarted cache resurrects yesterday's entries — including ones the owners invalidated or rewrote since | `--save "" --appendonly no`; empty-and-rebuild is the correct cold start |
| No eviction policy | The default (`noeviction`) makes every write fail once full; the cache degrades to read-mostly by accident | `--maxmemory 200mb --maxmemory-policy volatile-lru` — evictable keys and the work queue are separated by TTL, and the queue wins |
| Bad configuration failing quietly | A NaN TTL boots and behaves as 0 or as a crash, depending on the wind | `forRoot()` validates at registration; `Number(undefined)` is NaN and NaN is a boot-time `CacheConfigurationError`; a TTL a service reads for itself (`REQUEST_CACHE_TTL`) is checked with `assertTtlSeconds` when its module loads |
| `process.exit()` inside a shared library on bad config | A service that dies with no stack, no log, and no way to catch it | Typed errors thrown at registration; libraries never exit the process |
| Runtime `require()` inside a shared library | Works in the demo, breaks under bundlers, lazily-loaded modules, and half the test runners | ES imports only; there is no `require` anywhere in `libs/` |
| An aggregate computed from another cached entry | A stale value laundered into looking fresh — the cache vouching for itself | Only freshly loaded inputs feed a computed value; only the result is stored |
| A request key built from a raw argument list — `JSON.stringify(args)`, construction order | One request, N keys: parameter order decides which entry answers; duplicates expire independently, and a stale twin survives its sibling's refresh | `requestKey()` — sorted parameters, normalized route and names, values validated as given, canonical-or-it-throws |
| A blanket cache-everything decorator or interceptor | Caches auth-varied, per-user, and error responses *by default* — one caller's authorized answer served to another, an outage's error served after the recovery | Each composite is opted in by naming its registry key in the handler; a throwing `load` stores nothing |
| "Smart" list invalidation — membership on create/delete, content per item | A forgotten shape serves stale members with no witness: the membership/content split is a set of branches that can be wrong | Any write kills **every** list shape — one `delMany`, the count logged |
| A new entity appearing under a previously-denied id | A negative entry ("does not exist") outlives the thing it denied — a 404 served for an item that now exists | Every write path invalidates the item's key — creation included — and every write goes through the owner's write methods (registration calls `UsersService.create`) |
| Free-text query parameters reaching a key builder | An unbounded key space nobody can enumerate — and therefore nobody can invalidate | `requestKey()` refuses free-text values by construction; search reads the store every time |
| A composite whose body varies by who is asking | Authorization differences cached under one key — one caller's answer served to another | The rule is in code review, not code: identity-varying answers get identity segments and are entity caches, not request caches |

---

## What this repository does and does not demonstrate

This workspace is an example, not the production system the design came from. Everything under
`libs/` and `backend/` is real, runs, and is what the deep links point at. Four behaviours need
the real cache server before you can watch them happen:

| Behaviour | In production | In this repo |
| --- | --- | --- |
| **Cross-service sharing** | The whole point: consumers hit the owner's entries | Needs `CACHE_URL` pointed at a real server. With no `CACHE_URL` every service runs its own in-process store — everything works and **nothing is shared**. One docker command fixes it: see [Debugging the Cache](../guides/debugging-the-cache.md) |
| **ACL enforcement** | The server refuses a consumer's write | The manifests are real (`infra/git-ops/base/cache/acl-configmap.yaml`), and the consumer's code simply never writes the owner's keys — but only the real server *refuses* a write, which is the point of the ACL. `redis-cli` in the guide exercises it |
| **Eviction under pressure** | `volatile-lru` decides what survives when the cache fills — never the queue | Real flags, but the demo never writes 200 MB, so eviction is not observable at demo scale |
| **Queue durability across a worker crash** | Work accepted before a crash is drained after the restart | Real logic (the periodic reconcile), but demonstrating it requires the set to survive the process — which is the shared server, not the in-process store |

The consumer's read, the owner's invalidation, negative caching, the bypass-and-refresh, and the
batch drain are all demonstrable locally with nothing but `yarn dev:users-be`,
`yarn dev:products-be` and `yarn dev:sync`.

---

## Implementation

One library and three integrations:

| Package | What it holds |
| --- | --- |
| [`@tw/cache`](../../libs/tw-cache/README.md) | The client: key builder, two stores, the failure-policy layer, read-through, the test fake |
| [`users-service`](../../backend/users-service/README.md) | The **owner** — writes and invalidates `users-service_user_*` |
| [`products-service`](../../backend/products-service/README.md) | The **owner** of products, product lists and the catalog composite — and the **consumer** of user entries, read-only |
| [`products-sync-service`](../../backend/products-sync-service/README.md) | The **operator** — runs the work queue, the batch lock, and owns `categoryStats` |

### 1. The stores — one interface, two implementations

`ICacheStore` is the interface; `RedisCacheStore` (ioredis, `enableOfflineQueue: false`, a
per-command timeout, no re-sending after a reconnect, availability from connection events) and
`MemoryCacheStore` (for the no-`CACHE_URL` case and for tests) both implement it. The memory store
is not a toy: it serialises on write and parses on every read, so its serialization semantics
**match** the real store's — including that no reader ever holds an object shared with the cache —
and its `del` is deliberately type-agnostic: in Redis, `DEL` removes a key whatever it holds (an
entry, a set, a lock), and a memory store that only removes its own entries map diverges from that
on the first queue key. One difference cannot be emulated and is worth knowing: the in-process
store is reachable from the first microsecond, while the real client is still connecting at boot —
which is why nothing in the design depends on a check made at startup.

### 2. The policy layer — `CacheService`

Everything in the [failure-policy table](#the-failure-policy-per-operation) lives in one class, so
a service cannot re-decide it. The class also owns observability: `hits` / `misses` / `skipped`
counters and `isDisabled` are exposed on every participating service's `/health`, which turns
"is this service actually caching?" into a GET. **`skipped` climbing while `misses` stays flat is
the signature of a dead cache, not a cold one** — a cold cache misses and fills; a dead one skips
and never writes.

### 3. Read-through — `ReadThroughService`

One call replaces the check-load-store idiom at every call site, and carries the two behaviours
no store can provide: **negative caching** (a `null` load stores the sentinel for a short TTL)
and **single flight** — concurrent misses for one key share one `load` call through a per-key
in-flight map. A cache stampede is not caused by an empty cache; it is caused by N requests all
deciding, at the same moment, that they are the one who must fetch. A `no-cache` read is the one
that never joins: it starts its own load and supersedes the flight in progress, which then answers
its own callers but no longer writes the entry.

Single flight bounds how many loads a miss costs; it does not prevent the miss. Every waiter still
pays the load's latency when a hot key expires. Probabilistic early recomputation (Vattani et al.,
*Optimal Probabilistic Cache Stampede Prevention*, VLDB 2015) addresses that part — refreshing a
hot key shortly *before* it expires — and complements single flight rather than replacing it. This
design has not needed it yet.

The return type carries the `[]`-vs-sentinel distinction: a load that can never yield `null` — a
list — reads as `T`, not `T | null`, so the caller skips a check the design has already ruled
impossible. A nullable load (an entity that may not exist) reads as `T | null`, with `null` on a
negative hit.

Single flight is **per process** — concurrent misses on one pod share one load; with N replicas,
N loads can still run, and the stampede protection for entity reads is the *owner's* single
flight: the fan-out lands at the owner, which joins it into one source read and serves every
caller from that. List loads have no owner behind them (the load is this pod's own store read),
so a list stampede costs one store read per pod — bounded by the replica count, and visible as
`misses` climbing once per pod, not once per request.

### 4. The key builders — the registry

`cacheKey(name, id)` / `cacheKeyOrNull(name, id)` are the only way an entity key is produced, and
`requestKey(name, route, params)` the only way a request key is — all from the same registry, all
canonical-or-they-refuse, and none rewriting a value the loader will see.
The registry is declarative and shared —
this repository's choice, with an honest note: the alternative is owners exporting their own key
builders and consumers importing them, which couples consumer builds to owner packages. A
declarative registry trades that coupling for the discipline of updating one file when an entity
joins — and gets the ACL patterns, the invalidation code and the docs written from the same
single source.

### 5. The server — three flags and an ACL file

```yaml
args:
  - --maxmemory
  - 200mb
  - --maxmemory-policy
  - volatile-lru
  - --save
  - ""
  - --appendonly
  - "no"
  - --aclfile
  - /etc/valkey/acl/users.acl
```

Each flag is the deployment half of a rule the client enforces in code (see
[git-ops](../../infra/git-ops/README.md#the-shared-cache-server)). The eviction policy deserves its
one-paragraph justification, because the naive choice is wrong in a quiet way:
**`volatile-lru`, not `allkeys-lru`.** Under pressure the server evicts the least recently used
key *among those carrying a TTL* — which is every entity, list and composite entry, since all of
them are written with `EX` — and never the keys that hold no value. The work-queue set carries no
TTL, and an evicted queued id is a recomputation that silently never runs. `allkeys-lru` would make
that a memory-pressure event; `volatile-lru` makes it impossible. The trade this takes: no-TTL keys
cannot be evicted at all, so if they ever outgrew `maxmemory` the server would first shed every
service's entries and then refuse writes. That is why the queue is capped where work enters it
(ids validated, 100 per request, `MAX_QUEUE_SIZE` in total) — the cap turns the trade into a sizing
requirement rather than a risk. The batch lock also carries `EX`, so it remains evictable —
harmless: an evicted lock is an early release, and the lock is a cost optimisation, not the
correctness mechanism.

The server is one memory budget for every participant, and that is a trade-off of its own: ACLs
decide who may write which keys, not how much of the shared memory one service's traffic may take.
A participant whose volume grows can evict everyone else's entries. Watch per-prefix memory as
participants join, and give a heavy one its own instance before it becomes everyone's problem.

Two decisions live outside the flags. The Deployment uses `strategy: Recreate`: a rolling update
starts the new pod before stopping the old one, and for the overlap two unrelated caches sit
behind one Service — a service that reconnects lands on the new, empty one while its neighbours
still write, invalidate and enqueue on the old one. And the pod requests the memory it is limited
to: a pod using more than it requested is among the first evicted under node pressure, and evicting
this one empties the cache and the queue.

The per-service credential reaches the container as one variable, interpolated into the URL:

```yaml
- name: CACHE_PASSWORD      # from the cache-credentials Secret; the app never sees it alone
- name: CACHE_URL           # must come after CACHE_PASSWORD — $(…) expansion only sees earlier vars
  value: "redis://users-service:$(CACHE_PASSWORD)@cache:6379"
```

The client masks the URL in every log line it prints (`redis://users-service:***@cache:6379`), so
the credential that must reach the pod cannot leak through the one line most likely to be
copy-pasted.

---

## What a developer has to do

| To get | You do |
| --- | --- |
| The cache client, policy and counters | `CacheModule.forRoot({ url: process.env.CACHE_URL, ttlSeconds: Number(process.env.CACHE_TTL ?? 60), logger: { provide: CACHE_LOGGER, useExisting: LoggerService } })` — one import |
| A cached read with fill-on-miss | `const key = cacheKeyOrNull('user', id)`, then `key ? readThrough.readThrough({ key, load, traceId }) : load()` — an id that is not canonical is served uncached |
| A cached read honouring `no-cache` | pass `noCache: wantsFreshData(headers['cache-control'])` — the header stays a method parameter |
| Negative caching for "does not exist" | return `null` from `load`; **throw** on failure — null means proven-absent |
| A cached bounded list | the same read-through on `cacheKeyOrNull('productList', shape)` (`all`, `category.<name>`) — a non-nullable load, so an `[]` answer is typed `T`, never `T \| null` |
| List invalidation that cannot be wrong | one `delMany` of every shape after any write — never a membership/content split |
| A cached composite request | `readThrough` with `requestKey(name, route, params)` and a short `ttlSeconds` — the owner's writes invalidate it; the TTL bounds the parts other owners contributed |
| Invalidation after a write | `setImmediate(() => { const key = cacheKeyOrNull(…); if (key) void this.cache.del(key).then(log the count) })` — always, never header-gated, from every write path |
| A shared work queue | `addToSet(queueKey, ids)` — it throws when the add is not confirmed, and that is the feature; validate the ids and cap the queue before it |
| A batch that runs once | `acquireLock(lockKey, ttl)`; the drain deletes the lock and re-checks the queue when it finishes; the TTL is the release for a holder that crashed; a reconcile interval catches what every other path missed |
| "Is my service actually caching?" | `GET /health` — `store`, `disabled`, `hits`, `misses`, `skipped` |
| Cache behaviour in a test | inject `CacheFake` (`libs/tw-cache/src/test/cache.fake.ts`) — with a `setUnreachable()` knob for outage paths |

That is the whole developer contract. **No** per-pod cache to size, no serializer to configure,
no invalidation bus to subscribe to, no annotation whose semantics differ between environments.

---

## The honest comparison

The two designs this is most often compared against, and what each comparison actually shows.

### vs. a per-pod cache (or request-level memoisation)

**What is actually true:** a per-pod cache is simpler to operate — nothing shared, nothing to
lose — and for *immutable* reference data it can be enough.

**What is not true — do not claim these:** it is not "the same, just less shared." Every pod has
its own copy, so every pod has its own staleness; invalidation has no audience (the other pods
never hear about it); and the total memory cost is the working set multiplied by the replica
count. Worst of all, the failure mode is invisible: a pod's local cache cannot distinguish
"cache is down" from "I have my own," so an outage changes behaviour silently instead of
visibly.

**The defensible framing:** the shared cache buys one fill per entity for the whole cluster, a
single place to observe (hit/miss/skipped, by service), and invalidation that has exactly one
place to land. It pays with a network hop per read and a server to run — which is why the
in-process fallback is loudly labelled a misconfiguration, not a mode.

### vs. an invalidation bus (pub/sub)

**What is actually true:** pub/sub invalidation reacts in near-real-time across many replicas, and
scales to patterns this design does not attempt — per-entity subscriptions, cross-region
fan-out.

**What is not true:** it is not *required* for correctness, and it is not cheap. Consumers of the
same key race with the invalidation event; a missed message is a stale entry with no witness; and
the bus is a second piece of infrastructure whose failure modes (slow consumer, dropped message)
now belong to your cache.

**The defensible framing:** ownership makes the bus unnecessary at this scale. The one writer is
the one service that invalidates, so there is no coordination to do — the entry it wrote is the
entry it deletes, and every other service is a reader. When write rates or replica counts make
miss-storms visible (metrics show it: `misses` spiking after every invalidation), single flight
inside the library is the pressure valve, and it is already on.

### The trade-offs, stated fairly

| You get | You pay |
| --- | --- |
| One fill per entity per cluster | A network hop per read, hit or miss |
| Invalidation on every owner write, with no coordination | Freshness is "immediate in the common case, one TTL in the worst" — a stale fill or a dropped delete lives until its entry expires |
| Ownership that the server enforces (ACL), not just convention | A password per service, and rotation touches the ACL hashes and the Secret together — and lands with a cache restart |
| A failure policy decided once, observable everywhere | The policy is the library's — a service that needs different rules is fighting the design |
| Reads that survive a cache outage | The owners — not just their databases — absorb every consumer read while the cache is down, including any per-item fan-out the cache was hiding |
| A work queue and lock for free (sets and `SET NX` are primitives of the same server) | No retries, no DLQ; a cache restart drops the queue and a mid-drain crash loses the popped batch — re-POST is the answer; eviction of queued work is not a risk (`volatile-lru` never touches no-TTL keys), which is exactly why the queue needs a cap |
| Background work that survives a worker crash (periodic reconciliation) | One drain window per batch (`BATCH_DELAY_SECONDS`), not per-item latency; stranded work waits up to one reconcile interval |
| No per-pod tier, no serializer config, no bus | Everything shares one server: one availability domain to monitor like any other dependency, and one memory budget that a noisy participant can take from the rest |

---

## Applying this to other stacks

Nothing here is really about NestJS or even about Redis-protocol servers. The mechanism is four
decisions, and each has a framework-shaped answer but a framework-free meaning:

1. **Exactly one writer per entity, and the key says who.** Any key namespace. This is the
   decision everything else falls out of: invalidation has one author, ACLs have one pattern to
   scope, and consumers get a read-only contract instead of a plea.
2. **A failure policy per operation, decided once, in the client library.** Reads fail open;
   queue writes fail closed; bad arguments throw. The rule — *fail open when the cache is broken,
   loud when the caller is wrong* — survives any stack.
3. **Freshness is the caller's demand and it travels.** `Cache-Control` exists in every HTTP
   stack; the work is forwarding it (one default in the outbound client) and honouring it in the
   one place that can fix the entry (the owner's read path).
4. **The same primitives hold the background work.** A set with atomic pop and a key with
   atomic `SET NX EX` exist on every Redis-compatible server and on most document stores. When
   they do not: a real queue is a fine substitute for the set, but keep the lock atomic and
   self-releasing, keep acceptance fail-closed, bound the queue, and reconcile on an interval —
   not once at startup.

For the stack-specific halves: request-scoped DI is NestJS's way of making the logger ambient —
anywhere else, attach the read-through to a per-request context the way the
[tracing design](./distributed-tracing.md#applying-this-to-other-stacks) does for the id. The
registry is a plain object; the stores are one interface; the fake is one class.

### Adapting it — the parts that are ours, not yours

| Ours | Change it when |
| --- | --- |
| `{service}_{entity}_{id}` keys | Your store has real key hierarchies (hashes, namespaces) or you need hash-tag-aware sharding. The *ownership-encoding* is the part to keep, whatever the separator |
| A declarative registry shared by all services | Owners exporting their own builders fits your build graph better — it couples consumers to owner packages, but removes the "update the registry file" step. Either way, build keys in exactly one place per entity |
| Redis protocol (valkey) with ioredis | Your platform's managed cache is fine; keep `enableOfflineQueue: false`'s equivalent — commands must reject, not queue, while disconnected — and a per-command deadline, so a silent server fails open too |
| `Cache-Control: no-cache` as the freshness verb | You need field-scoped freshness or write-through on demand — a custom header is equally honest, just document it in the API contract the same way |
| TTL-only expiry, 60 s user entries / 300 s aggregates | Your staleness budget differs per entity — that is what per-call `ttlSeconds` overrides are for |
| Lists killed wholesale on any write | Your write rate keeps the list hit rate near zero — then shorten the TTL or drop the list cache; the fix is never per-item list invalidation |
| A TTL-only composite under a canonical request key | You need field-scoped freshness or a write-through composite — then it is an entity cache wearing a request cache's key; build it as the entity cache it is |
| A 5 s batch delay with a 10 s lock, released by the drain | Your recompute cost and request rates differ. The invariants: lock TTL ≥ delay (so a burst collapses into one drain), a drain that releases the lock and re-checks the queue when it finishes (or work arriving after its last pop waits for the next trigger), and a reconcile interval as the safety net |
| Placeholder credentials committed as a demo | Never. This repo does it on purpose and labels it; a real deployment sources them from a secret manager |

**The reason this stays cheap is that it lives in a library, not in services.** The key builder,
the failure policy and the read-through are each decided once. A change to any of them is a
version bump and a rollout, not a search through a dozen repositories. That is the same argument
the tracing design makes for its split, and it is worth repeating here because the failure mode
of *not* centralising is worse for a cache than for a header name: each service that re-implements
its own cache-aside gets to re-decide the failure policy, and the one that decides "throw on
read" is the one that takes the cluster down when the cache hiccups.

---

## Related

- [Debugging the Cache](../guides/debugging-the-cache.md) — the runbook: stale entries, silent
  misses, dead invalidations
- [@tw/cache](../../libs/tw-cache/README.md) — the library, its three roles, and the fake
- [API Contracts](./api-contracts.md) — where `Cache-Control` sits in the request contract
- [Distributed Tracing](./distributed-tracing.md) — the trace family a batch drain produces, and
  the two-connector pattern the operator role demonstrates
- [git-ops](../../infra/git-ops/README.md) — the server deployment: flags, ACL, credentials
- [Architecture Overview](./architecture.md)
