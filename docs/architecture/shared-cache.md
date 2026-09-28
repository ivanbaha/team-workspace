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

- **The builder normalizes and validates.** `cacheKey('user', id)` lowercases and trims the id,
  rejects anything that is not a string or a number — an object, `undefined`, a boolean — and
  validates the result against `[a-z0-9][a-z0-9._-]*`. The normalization is *in the builder*, not
  at each call site, because the first consumer to pass `userId` where `UserName` was expected is
  a matter of time; when the builder owns the casing, that mistake produces one key instead of two.

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
  aggregate from raw products fetched on the spot, never from another cached entry — a cache
  entry derived from a cache entry is a stale value that has been laundered into looking fresh.

### The failure policy, per operation

The heart of the design, because a cache's failure modes are *silent* by default — every one of
these rows is a decision, not an accident:

| Operation | Server unreachable | Why |
| --- | --- | --- |
| `get` | `null`, indistinguishable from a miss | The source of truth still answers; a cache outage must not take requests down. The `skipped` counter on `/health` is what tells you it is happening |
| `set` / `del` / `delMany` | dropped | A cache write is an optimisation, never a commitment. Dropping one is the correct response to a broken cache |
| `addToSet` | **throws** `CacheUnavailableError` | Set adds are queue writes. Reporting "accepted" for work that was never stored loses work — the controller maps this to `503`, and the response says nothing was enqueued |
| `acquireLock` | `false` | Without the server there is no way to know the lock is free; "not acquired" is the only safe answer |
| invalid arguments, bad TTLs | **throws** `CacheConfigurationError` at boot or at call | Programmer error. Failing open *here* would hide the mistake behind plausible-looking behaviour |

One sentence governs the whole table: **the cache fails open when the cache is broken, and loud
when the caller is wrong.**

The reachability is not polled — it comes from the client's own connection events (`ready`,
`error`, `end`), so a full cache outage costs each service a handful of log lines, not a stream of
timeouts. The client is created with `enableOfflineQueue: false`: a command issued while
disconnected rejects immediately instead of queueing invisibly behind a reconnect, so a write can
never be flushed against state that recovered hours later.

### Freshness: `Cache-Control: no-cache`

A caller who suspects a stale entry says so once, in the header every HTTP stack already has:

```txt
Cache-Control: no-cache
```

The semantics are **bypass and refresh** — the service skips the cached read, loads from the
source of truth, and overwrites the entry, so the demand *repairs* the cache for every following
reader, not just the caller who asked. A bypass that left the stale entry in place would re-serve
it to the very next reader, and the person who sent the header would conclude it does nothing.

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

Every decision in those six lines is one of the traps from the section below: the invalidation
is **unconditional** (never gated on a header), it runs **off the response path**
(`setImmediate` — the caller's write is not held hostage to a cache round trip), and **the delete
count is logged every time**, because a `DEL` that removed nothing is the only witness of a dead
invalidation. `DEL` returns the number of keys removed; a `del` that swallows it has no way to
know it just failed.

One consequence of `setImmediate` is worth stating plainly: **a read that races the invalidation
can still see the stale entry.** The write returns, the client immediately re-fetches, and its
GET lands against the cache before the deferred `DEL` does — the change looks reverted for one
moment. Awaiting the `DEL` would not close the window: a cache delete is best-effort and is
*dropped* while the cache is unreachable (the failure-policy table), so the window exists
whenever the cache is down no matter what the write path does. The design takes the tiny window
plus the repair over the latency: the client that must read its own write sends
`Cache-Control: no-cache` — the bypass-and-refresh exists for precisely this — and the next
reader gets the corrected entry.

### The list — cached whole, invalidated wholesale

A list has two ways to be stale — *membership* (which items it contains) and *content* (what each
item says) — and most list-caching designs fail by treating them differently. This design treats
them the same, deliberately: **any write to any product kills every cached list shape.**

```ts
// products-service, after any create/update/remove:
private invalidateAfterWrite(productId: string, extraCategories: string[] = []): void {
  const keys = [...this.listKeys(extraCategories), cacheKey('product', productId)];
  setImmediate(() => {
    void this.cache.delMany(keys).then((removed) => { /* log the count */ });
  });
}
```

`GET /v1/products` (and `?category=`) reads the whole hydrated list as **one value** through the
same read-through as an entity — under `products-service_productList_all` or
`products-service_productList_<category>`. The shapes are enumerable, which is what makes the
wholesale rule implementable: one `delMany` of `all` plus one key per category, and the write's
own item key. An update that moves a category passes the *old* category explicitly, and a delete
passes the deleted product's — an emptied category is a shape the store can no longer name, and
the one a naive "scan the store" would skip.

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
  load: () => this.loadTheCatalog(),   // list + owner hydration, the expensive composite
  ttlSeconds: Number(process.env.REQUEST_CACHE_TTL ?? 10),
  noCache,                              // a caller's no-cache still repairs the entry
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

The parts inside the composite read through their own
caches, which is safe for a reason the rest of this page builds: everything below the composite is
invalidated on write, so cached parts are always *correct* — a recompute rebuilds the composite
from parts that are, as always, fresh-or-absent. The owner-hydration fan-out inside a recompute is
also bounded twice: users-service's own single-flight serves N concurrent asks from one load, and
the composite itself only recomputes once per TTL window.

The key is built by `requestKey()`, not by hand, because the whole failure mode of request
caching is that the same question can be *spelled* several ways — parameters in a different
order, different casing, `?expandOwner=true` versus an absent default. Two spellings must produce
one key, or the cache quietly holds duplicates that expire independently: a hit rate that reads
fine while half the traffic misses, and a stale twin that survives the refresh of its sibling.
The helper's serialization is **canonical or it throws**: sorted parameters, normalized segments,
and values limited to what a key segment survives — free text included, refused by design.

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
    S->>K: SADD products-sync-service_queue [ids]  (duplicates collapse)
    S->>K: SET products-sync-service_batch-lock "" NX EX 10
    alt lock acquired
        Note over S: setTimeout(drain, BATCH_DELAY_SECONDS * 1000)
        S-->>C: 202 {queued, scheduled: true}
    else lock held
        S-->>C: 202 {queued, scheduled: false}  (a drain is already armed)
    end
    Note over S: ... the delay window ...
    S->>K: SPOP queue 100  → ids (atomic: no two drains hand out the same id)
    S->>K: DEL stats keys, ONE round trip — before any network call
    loop each category
        S->>P: GET /v1/products?category=…  (service token; derived trace id)
        S->>K: SET categoryStats_<id> (fresh aggregate, TTL 300)
    end
```

The queue is a **Redis Set**: `SADD` enqueues with dedup for free (re-posting a pending id
changes nothing), `SPOP` drains *atomically* — two drains can never hand out the same category —
and the set survives a crash of the service, which is the entire reason the queue lives on the
shared cache and not in a timer. At startup, the service counts what it finds in the set and
schedules a drain for any orphans: work accepted seconds before a crash is finished after the
restart, instead of sitting in the set while its entry goes stale.

The durability claim has a boundary, and it should be stated rather than discovered: **the
in-flight window.** `SPOP` removes an id before its recomputation finishes, so a crash mid-drain
loses the popped-but-unprocessed batch — the startup reconciliation finds the set empty and has
nothing to drain. For this example that is the accepted trade-off (the window is seconds wide,
the work is re-POSTable, and the production estate's own target state moves such queues to
durable infrastructure); a queue whose in-flight loss is unacceptable needs a two-phase
pop (`SMOVE` to a processing set, ack on completion) or a real broker, not a longer
`SPOP` argument. The same boundary covers a cache-server restart: with persistence off
(deliberately), an unpopped queue is destroyed with everything else — re-POST is the recovery
story there too.

The lock is **`SET NX EX`**, atomic acquire-with-TTL, and *the TTL is the release* — there is no
unlock call anywhere, because a process that died between acquiring and draining must not block
scheduling forever. The lock is also a cost optimisation, not the correctness mechanism: if it
expired early, two drains would simply split the set between them, because `SPOP` hands each id
to exactly one.

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
| Keys built by hand, casing drifting per call site | Owner and consumer address two different keys for one entity; every consumer read is a miss, every owner invalidation misses | The registry + normalizing builder; keys are never concatenated by hand |
| Passing the wrong identifier into a key builder (an object, `undefined`) | Entries keyed by `"[object Object]"`; a whole class of data never hits | `cacheKey()` rejects anything but string/number, and validates the shape |
| Treating `DEL` as fire-and-forget | A dead invalidation has no witness — the log says nothing, the entry stays, nothing anywhere is wrong | `del` returns the count; the count is logged *every* time; a `0` is visible |
| Invalidating a batch one key at a time, interleaved with network calls | A long window of stale reads; N round trips; a slow upstream stretches the window | `delMany` first, one `DEL`, before any recomputation |
| One shared cache credential with `+@all` | Any service's bug can `FLUSHALL` every other service's entries | Per-service ACL users scoped to a key pattern; `-@dangerous`; `default off` |
| `SET` then `EXPIRE` as a lock (two steps) | A crash between them leaves a lock that never releases; the queue stalls forever | `SET NX EX` is atomic; the TTL *is* the release, and there is no unlock call to get wrong |
| The queue as an in-memory list plus a timer | A restart silently loses every accepted item; the `202` already went out | The set lives on the shared cache; startup reconciliation drains orphans |
| Accepting work while the queue backend is down | `202 Accepted` for work that was never stored — the caller never retries | `addToSet` throws; the endpoint answers `503 CACHE_UNAVAILABLE` saying *nothing was enqueued* |
| Background jobs borrowing nobody's credentials | Everything works from curl; the cron's calls all die 401 | The drain mints a service token of its own, once per run |
| A per-pod in-memory fallback "so it always works" | N pods = N caches that never share; a broken shared cache becomes invisible, and the data disagrees between neighbours | The only fallback is the library's in-process store, which **logs a loud warning** and reports `store: "memory"` on `/health` |
| A memory store with its own value semantics | Tests pass while the real store serialises differently — `Date` becomes an object here, a string there; `undefined` vanishes | The memory store round-trips every value through JSON, exactly what the real store does |
| A test fake that can drift from the real client | The suite stays green while behaviour diverges; the bug ships with passing tests | `CacheFake` is an independent reimplementation, and `cache.fake.spec.ts` runs one behavioural suite against **both** implementations |
| Persistence enabled on the cache | A restarted cache resurrects yesterday's entries — including ones the owners invalidated or rewrote since | `--save "" --appendonly no`; empty-and-rebuild is the correct cold start |
| No eviction policy | The default (`noeviction`) makes every write fail once full; the cache degrades to read-mostly by accident | `--maxmemory 200mb --maxmemory-policy volatile-lru` — evictable keys and the work queue are separated by TTL, and the queue wins |
| Bad configuration failing quietly | A NaN TTL boots and behaves as 0 or as a crash, depending on the wind | `forRoot()` validates at registration; `Number(undefined)` is NaN and NaN is a boot-time `CacheConfigurationError` |
| `process.exit()` inside a shared library on bad config | A service that dies with no stack, no log, and no way to catch it | Typed errors thrown at registration; libraries never exit the process |
| Runtime `require()` inside a shared library | Works in the demo, breaks under bundlers, lazily-loaded modules, and half the test runners | ES imports only; there is no `require` anywhere in `libs/` |
| An aggregate computed from another cached entry | A stale value laundered into looking fresh — the cache vouching for itself | Only freshly loaded inputs feed a computed value; only the result is stored |
| A request key built from a raw argument list — `JSON.stringify(args)`, construction order | One request, N keys: parameter order and casing decide which entry answers; duplicates expire independently, and a stale twin survives its sibling's refresh | `requestKey()` — sorted parameters, normalized segments, canonical-or-it-throws |
| A blanket cache-everything decorator or interceptor | Caches auth-varied, per-user, and error responses *by default* — one caller's authorized answer served to another, an outage's error served after the recovery | Each composite is opted in by naming its registry key in the handler; a throwing `load` stores nothing |
| "Smart" list invalidation — membership on create/delete, content per item | A forgotten shape serves stale members with no witness: the membership/content split is a set of branches that can be wrong | Any write kills **every** list shape — one `delMany`, the count logged |
| A new entity appearing under a previously-denied id | A negative entry ("does not exist") outlives the thing it denied — a 404 served for an item that now exists | The write path invalidates the item's key too, unconditionally |
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
| **Queue durability across a crash** | Work accepted before a crash is drained after the restart | Real logic (`onApplicationBootstrap` reconciliation), but demonstrating it requires the set to survive the process — which is the shared server, not the in-process store |

The consumer's read, the owner's invalidation, negative caching, the bypass-and-refresh, the batch
drain, and the startup reconciliation are all demonstrable locally with nothing but
`yarn dev:users-be`, `yarn dev:products-be` and `yarn dev:sync`.

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

`ICacheStore` is the interface; `RedisCacheStore` (ioredis, `enableOfflineQueue: false`,
availability from connection events) and `MemoryCacheStore` (for the no-`CACHE_URL` case and for
tests) both implement it. The memory store is not a toy: it round-trips values through JSON so
its serialization semantics **match** the real store's, and its `del` is deliberately
type-agnostic — in Redis, `DEL` removes a key whatever it holds (an entry, a set, a lock), and a
memory store that only removes its own entries map diverges from that on the first queue key.

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
deciding, at the same moment, that they are the one who must fetch.

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

`cacheKey(name, id)` is the only way an entity key is produced, and `requestKey(name, route,
params)` the only way a request key is — both from the same registry, both canonical-or-they-throw.
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
TTL: it is the one durable thing on this server, and an evicted queued id is a recomputation that
silently never runs. `allkeys-lru` would make that a memory-pressure event; `volatile-lru` makes
it impossible. The trade this takes: no-TTL keys cannot be evicted at all, so if they ever
outgrew `maxmemory` the server would refuse writes rather than shed — the queue is bounded by the
number of categories, which turns that trade into a sizing requirement rather than a risk. The
batch lock also carries `EX`, so it remains evictable — harmless: an evicted lock is an early
release, and the lock is a cost optimisation, not the correctness mechanism.

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
| A cached read with fill-on-miss | `readThrough.readThrough({ key: cacheKey('user', id), load, traceId })` |
| A cached read honouring `no-cache` | pass `noCache: wantsFreshData(headers['cache-control'])` — the header stays a method parameter |
| Negative caching for "does not exist" | return `null` from `load`; **throw** on failure — null means proven-absent |
| A cached bounded list | the same read-through on `cacheKey('productList', shape)` — a non-nullable load, so an `[]` answer is typed `T`, never `T \| null` |
| List invalidation that cannot be wrong | one `delMany` of every shape after any write — never a membership/content split |
| A cached composite request | `readThrough` with `requestKey(name, route, params)` and a short `ttlSeconds` — the TTL is the whole invalidation |
| Invalidation after a write | `setImmediate(() => void this.cache.del(key).then(log the count))` — always, never header-gated |
| A shared work queue | `addToSet(queueKey, ids)` — it throws when the cache is down, and that is the feature |
| A batch that runs once | `acquireLock(lockKey, ttl)`; the TTL is the release; there is no unlock |
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
| Ownership that the server enforces (ACL), not just convention | A password per service, and rotation touches the ACL file and the Secret together |
| A failure policy decided once, observable everywhere | The policy is the library's — a service that needs different rules is fighting the design |
| A work queue and lock for free (sets and `SET NX` are primitives of the same server) | No retries, no DLQ, and a queue whose in-flight window is lost to a mid-drain crash — re-POST is the answer; eviction of queued work is not a risk (`volatile-lru` never touches no-TTL keys) |
| Background work that survives a crash (reconciliation at startup) | One drain window per batch (`BATCH_DELAY_SECONDS`), not per-item latency |
| No per-pod tier, no serializer config, no bus | Everything shares one server: it is a availability domain to monitor like any other dependency |

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
   self-releasing, keep acceptance fail-closed, and keep the startup reconciliation.

For the stack-specific halves: request-scoped DI is NestJS's way of making the logger ambient —
anywhere else, attach the read-through to a per-request context the way the
[tracing design](./distributed-tracing.md#applying-this-to-other-stacks) does for the id. The
registry is a plain object; the stores are one interface; the fake is one class.

### Adapting it — the parts that are ours, not yours

| Ours | Change it when |
| --- | --- |
| `{service}_{entity}_{id}` keys | Your store has real key hierarchies (hashes, namespaces) or you need hash-tag-aware sharding. The *ownership-encoding* is the part to keep, whatever the separator |
| A declarative registry shared by all services | Owners exporting their own builders fits your build graph better — it couples consumers to owner packages, but removes the "update the registry file" step. Either way, build keys in exactly one place per entity |
| Redis protocol (valkey) with ioredis | Your platform's managed cache is fine; keep `enableOfflineQueue: false`'s equivalent — commands must reject, not queue, while disconnected |
| `Cache-Control: no-cache` as the freshness verb | You need field-scoped freshness or write-through on demand — a custom header is equally honest, just document it in the API contract the same way |
| TTL-only expiry, 60 s user entries / 300 s aggregates | Your staleness budget differs per entity — that is what per-call `ttlSeconds` overrides are for |
| Lists killed wholesale on any write | Your write rate keeps the list hit rate near zero — then shorten the TTL or drop the list cache; the fix is never per-item list invalidation |
| A TTL-only composite under a canonical request key | You need field-scoped freshness or a write-through composite — then it is an entity cache wearing a request cache's key; build it as the entity cache it is |
| A 5 s batch delay with a 10 s lock | Your recompute cost and request rates differ; the only invariant is lock TTL ≥ delay |
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
