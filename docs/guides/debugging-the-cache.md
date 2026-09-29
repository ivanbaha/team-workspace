# Debugging the Cache

What to do when the cache looks wrong: a stale answer, a hit rate that never moves, an
invalidation that did not happen, a queue that stopped draining.

How the design works and why it is shaped this way:
[Shared Cache](../architecture/shared-cache.md).

---

## The 30-second version

The design is observable on purpose — every question below is answered by one of three places,
no log archaeology required:

```bash
# 1. Is the service actually caching? store, disabled, hits/misses/skipped:
curl -s localhost:4002/health

# 2. What did THIS request do with the cache? (debug level turns on the decision lines):
LOGGER_LEVEL=debug yarn dev:products-be   # then read the trace for {"cache":"hit"|...} lines

# 3. What is actually IN the cache? ask the server:
docker exec -it workspace-cache valkey-cli TTL users-service_user_1
```

Everything below is one of those three, read correctly.

---

## Symptom → cause → do

| Symptom | What it almost always is | Do |
| --- | --- | --- |
| "The cache does nothing" — miss on every read | Services are not on the **same** cache: `store: "memory"` on `/health` means in-process, nothing shared | Point `CACHE_URL` at the same server for every participant — see [the local setup](#seeing-the-sharing-actually-happen) |
| A stale answer once, then correct | A stale fill (a read that loaded before the write stored after its `DEL`), a dropped invalidation, or the deferred `DEL` racing the read — all bounded by the entry's TTL | `Cache-Control: no-cache` — the repair is a header, and it sticks for the next reader |
| Stale *every* time for one entity | Dead invalidation: the owner's `del` used a different key than the read | Read a fresh entry, write, and find the `removed 0` line — see [reading the invalidation count](#reading-the-invalidation-count) |
| Misses spike, then everything is fine again | Normal: TTL expiry or a batch just invalidated entries on purpose | Nothing. `misses` climbing while `skipped` stays flat is a *cold* cache, not a broken one |
| `skipped` climbing, `misses` flat | The cache server is unreachable; reads fail open | `disabled: true` on `/health` says the client agrees. Find the cache pod, not the service |
| Reads slow by ~250 ms, then `disabled: true` while the cache pod looks healthy | The server stopped answering on an open connection — a hung process, or a node that went away without closing its sockets. Each command waits out `commandTimeoutMs`; three in a row mark the cache unreachable and the client reconnects | Look for `Cache commands timed out 3 times in a row` in the service logs. If the pod is up but unresponsive, restart it; if the node is gone, the reconnect lands once the Service points somewhere live |
| `GET /v1/users/%201` answers 404 while `/v1/users/1` works | Expected: identifiers are matched exactly as sent. A spelling that is not canonical cannot form a cache key, so it is answered from the store, uncached | Nothing — and it can no longer overwrite user 1's entry, which is the point |
| `503 CACHE_UNAVAILABLE` on POST /v1/recalculations | The queue is a cache write, and it fails **closed** — the cache did not confirm the add | Retry once the cache is back. A timed-out add may have landed anyway; re-sending it is harmless, because the set deduplicates |
| `503 QUEUE_FULL` on POST /v1/recalculations | The queue holds `MAX_QUEUE_SIZE` ids already — it is capped because it is never evicted | Nothing was enqueued. Check the drain is running (sync logs: `{"batch":"start"…}`); retry once it has caught up |
| The batch ran but some categories have no entry | Their recomputation failed — logged and dropped, not re-queued | Grep the sync logs for `Recomputation of category … failed (upstream <status>)` under the run's derived trace id; fix the cause, re-POST |
| A list is stale after a write | Either the write's invalidation removed nothing, or the read is a shape no invalidation covers | Find the `Invalidation removed 0` line first. If the count was right, check the read for `?search=` — search is never cached, so a "stale" search result came from the store, not the cache |
| `?expandOwner=true` answers stale data | Stale *product* data should not happen — the service's own writes kill the composite. Stale *owner* data is the design: users-service's contribution is TTL-bounded | If it is product data: find the `Invalidation removed 0` line. If it is owner data: wait out `REQUEST_CACHE_TTL`, or send `Cache-Control: no-cache` to refresh it now — it bypasses the composite and the owner entries it is built from |
| "I wrote, then re-read, and saw the old value" | The re-read raced the deferred invalidation (`setImmediate`), or a read that loaded the source before your write stored its value after the `DEL` | Send `Cache-Control: no-cache` on the re-read — it starts a fresh load (it never joins one already in flight) and overwrites the entry. Without it, the old value lives at most one TTL |
| Work accepted before a crash/sync-restart never ran | Usually nothing is wrong yet: the reconcile pass schedules queued work every `RECONCILE_INTERVAL_SECONDS`. Two cases do lose work: a crash mid-drain loses the popped batch (the in-flight window), and a **cache** restart drops the whole queue (persistence is off) | Wait one reconcile interval and look for `Found N queued recalculation(s) with no drain scheduled`. If the queue itself is empty, re-POST the categories. If that loss is unacceptable, the queue belongs on durable infrastructure — Redis Streams with consumer groups on a persistent instance, or a broker |
| The same request seems cached twice (hit rate ~50% no matter what) | Hand-built keys: param order or casing reaching the key | All request keys go through `requestKey()`, which sorts parameters and normalizes the route and names — a duplicated entry means a key that did not. Find it with `valkey-cli --scan --pattern '*req*'` (as an operator user — service users may not `SCAN`) |
| Keys multiply without bound | An unbounded shape reached the key builder — free text, ad-hoc page guesses | `valkey-cli --scan --pattern '*' | wc -l` over time; every cached shape must be enumerable at invalidation time (the registry is the inventory) |

---

## Repair with a header, not a flush

The most common "the cache is wrong" incident is one entity. The repair is a single request, and
it leaves the cache *better* than it found it:

```bash
curl "http://localhost:4001/v1/users/1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Cache-Control: no-cache"
```

`no-cache` means **bypass and refresh**: the owner skips the cached read, loads from its source of
truth, and overwrites the entry. The next reader finds the fresh value — which is the difference
between a repair and a workaround. If you are several hops away, the header still works: the
connector forwards it by default, and the demand reaches whichever service owns the entry.

What it is **not**: a flush. It corrects one key, and `no-cache` on a write route does nothing —
writes always invalidate, whether or not the caller asks.

---

## Reading the cache lines under a trace id

At `debug`, every cache decision writes one line carrying the trace id, so the whole story of one
request is one grep. Give the request an id first:

```bash
curl "http://localhost:4002/v1/products?expandOwner=true" \
  -H "Authorization: Bearer $TOKEN" -H 'x-trace-id: cache-debug-1'
```

Then `grep cache-debug-1` across both services' terminals. The lines, and what each one means:

| Line | Means | The next line tells you |
| --- | --- | --- |
| `{"cache":"miss","key":"users-service_user_1"}` | Consumer checked the owner's entry; it was not there | Either an HTTP call to the owner (the trace shows it) or `joined` |
| `{"cache":"hit","key":…}` | Answered from the cache. No HTTP hop, no trace fan-out — its absence *is* the evidence | `response.out` follows directly |
| `{"cache":"negative-hit","key":…}` | The owner has proven this does not exist; answered without a call | If you expected the entity to exist by now: the owner's negative TTL has not passed, or the owner re-proved absence |
| `{"cache":"joined","key":…}` | Another in-flight miss was already loading this key; this request joined it | One load for N concurrent readers — normal, not a bug |
| `{"cache":"bypass","key":…}` | `no-cache` honoured: the cached read was skipped | A fresh load and an overwrite follow — never a `joined` |
| `{"cache":"superseded","key":…}` | A `no-cache` read replaced this load while it ran; this load's (older) value went to its own callers but was not written | Nothing — this is what keeps a repair from being overwritten |

The `key` on every line is registry-built, and its shape says which builder made it —
`{service}_{entity}_{id}` for entities and lists (`users-service_user_1`,
`products-service_productList_all`), or `{service}_req_{route}_{params}` for a composite
(`products-service_req_v1-products_expandowner=true`). A key in any other shape was not built
by the registry at all, and that is the bug.

### Reading the invalidation count

The owner logs every invalidation with the delete count:

```txt
Invalidation removed 1 cache entry for user 1 (key users-service_user_1)
```

**`removed 0` after a successful store write means the invalidation targeted a key that did not
exist**, and on its own that is usually healthy. It is one of three things:

1. **Nothing was cached.** The most common case by far: most writes touch entries nobody has read
   since they last expired or were invalidated.
2. **The cache was unreachable** and the delete was dropped. The client logs
   `Cache unreachable — invalidation of <key> dropped` at debug just before it, and `/health`
   shows `disabled: true`. The old entry, if there was one, lives at most one TTL once the cache is
   back.
3. **The key was built differently** from the key the entry was cached under — the bug: the
   wrong identifier, a hand-built string. The log line prints the key it used; compare it with the
   key on the reader's `{"cache":"hit",…}` lines. They are the same key or the fix is wherever
   the difference is.

So use the count as a probe, not an alarm: read the entity first (so the entry exists), write it,
and expect `removed 1`. A `0` there, with the cache reachable, is case 3. The design prevents
case 3 by construction — every key comes from one registry and one builder — and a test that
reads, writes and reads again is what catches it for good.

---

## Reading `/health` correctly: cold vs dead

```json
{"data":{"status":"ok","service":"products-service","cache":
  {"store":"redis","disabled":false,"hits":48,"misses":12,"skipped":0}}}
```

Three diagnoses, three shapes:

| Shape | Meaning |
| --- | --- |
| `misses` moves, `skipped` flat | **Cold.** Entries expire and get re-fetched — the cache is doing its job |
| `skipped` moves, `misses` flat | **Dead.** The client cannot reach the server; reads fail open (requests still succeed) and queue writes answer 503. Find the cache pod |
| `store: "memory"` | **Not shared.** No `CACHE_URL` reached the process — this pod has a private store, so nothing it writes is visible to any other service, and it will say so in its own boot log |
| `hits` never moves across many reads | Entries are never surviving long enough to be read again: check the TTL the service booted with (`CACHE_TTL`), then confirm both services point at the same server |

The `store` field is honest on purpose: the in-process fallback exists so a missing
configuration degrades to "works, but shares nothing" instead of a crash — and it *identifies
itself*, in the health output and in a loud boot-time warning, precisely so this table can exist.

---

## Seeing the sharing actually happen

Everything above works with zero setup — but with no `CACHE_URL`, every service silently runs its
own in-process store, so you cannot observe a *consumer hit* or a *durable queue*. One container
fixes that:

```bash
docker run -d --name workspace-cache -p 6379:6379 docker.io/valkey/valkey:8.1.3
```

Then run each service with the URL in its environment:

```bash
CACHE_URL=redis://localhost:6379 yarn dev:users-be
CACHE_URL=redis://localhost:6379 yarn dev:products-be
CACHE_URL=redis://localhost:6379 yarn dev:sync
```

(That container runs without the ACL — it is the same server the cluster runs, minus the
credential layer. The ACL demo is [below](#the-acl-refusing-a-write-is-the-design-working).)

Now the cross-service read is visible twice — in the logs and on the server:

```bash
# 1st request for /v1/products?expandOwner=true:
#   products-service logs {"cache":"miss",...} then calls users-service
# 2nd identical request:
#   products-service logs {"cache":"hit","key":"users-service_user_1"} and NEVER calls users-service

docker exec -it workspace-cache valkey-cli
> GET users-service_user_1          # the entry the owner filled on the first read
> TTL users-service_user_1         # counting down from CACHE_TTL
> GET users-service_user_1          # the value; "not_present" here means a negative entry
```

**A negative entry, on purpose:** ask for a category that has no products —
`GET /v1/category-stats/nope` on the sync service. The first read calls products-service, finds
nothing, stores the sentinel, and answers 404; the second identical request answers from the
entry, and the trace shows *no call to products-service at all*:

```bash
docker exec -it workspace-cache valkey-cli GET products-sync-service_categoryStats_nope
# "not_present"  ← the sentinel, stored with a short TTL by the owner after the first 404
```

### The queue surviving a restart

With the real server, the set — and therefore accepted work — outlives the service process:

```bash
TOKEN=…   # a JWT from users-service, as in the READMEs
curl -X POST localhost:4003/v1/recalculations -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"categoryIds":["widgets"]}'
# then kill the sync service INSIDE the 5-second delay window and restart it:
#   yarn dev:sync
# within RECONCILE_INTERVAL_SECONDS (30 by default) the log says:
#   Found 1 queued recalculation(s) with no drain scheduled — scheduling one
```

That is the reconcile path: the `202` went out before the crash, so the work is owed — the set is
where it waits, and the periodic pass finds it once the cache client is connected (a check made at
boot would run before the connection and read the set as empty). If the restart comes within
`LOCK_TTL_SECONDS` of the crash, the dead process's lock is still held, and the pass simply
schedules the drain on its next run.

Its boundary: work that was already *popped* by a drain that then crashed is lost (the set is
empty of it), and a **cache-server** restart destroys the whole queue with everything else —
persistence is off on purpose. Re-POST is the recovery for both.

### The outage, on purpose

Stop the container (`docker stop workspace-cache`) while the services run:

- Reads keep answering — **200s** — and `/health` shows `disabled: true` and `skipped` climbing.
  That is fail-open, observable.
- `POST /v1/recalculations` answers **503 CACHE_UNAVAILABLE**, and nothing was enqueued. That is
  fail-closed, honest about it.
- Restart the container and the client reconnects on its own: one warn line down, one info line
  back up, no restart of any service.

A server that hangs instead of stopping is the harder case — the connection stays open and no
event says anything is wrong. `docker pause workspace-cache` reproduces it: each read waits out
`commandTimeoutMs` (250 ms) and fails open; after three in a row the service logs
`Cache commands timed out 3 times in a row` and `/health` shows `disabled: true`, so later reads
fail open instantly. `docker unpause workspace-cache` and the reconnect brings it back.

### The ACL refusing a write is the design working

Run the server with the same ACL file the cluster uses — copy the four `user …` lines out of
[`infra/git-ops/base/cache/acl-configmap.yaml`](../../infra/git-ops/base/cache/acl-configmap.yaml)
into `/tmp/users.acl` (the `#…` values are SHA-256 hashes of the demo passwords; the server
compares against them, so the cleartext placeholders below still log in) — then:

```bash
docker run -d --name workspace-cache -p 6379:6379 \
  -v /tmp/users.acl:/acl/users.acl:ro \
  docker.io/valkey/valkey:8.1.3 --aclfile /acl/users.acl

docker exec -it workspace-cache valkey-cli --user products-service --pass products-service-CHANGE-ME
> GET users-service_user_1             # fine — a consumer reads the entity it consumes
> SET users-service_user_1 1           # (error) NOPERM … — the server refuses the write
> GET users-service_session_1          # (error) NOPERM … — only the `user` entity is granted
> SCAN 0                               # (error) NOPERM … — no listing every key on the server
> SET products-service_productList_all x   # fine — its OWN prefix: an owner must be able to
>                                      # invalidate what it owns
```

That refusal is the consumer role enforced, not requested: products-service's code never writes
the owner's keys, and *the server independently refuses if it ever tries* — a bug that cannot
corrupt another service's data. The writable half is just as deliberate: the same user can write
its own prefix, because an owner that could not invalidate its own entries would have no
invalidation at all. The cache-side counterpart: connect as `users-service` and try
`SADD products-sync-service_queue x` — same refusal, other direction.

---

## Turning a cache incident into a bug report

Four lines make a cache bug actionable, and three of them are copy-paste:

1. The **key** — from the `{"cache":"hit"|"miss",…}` line (or the health output if you know which
   entity).
2. The **trace id** — the decision lines carry it; so does the `503` or the error you are
   reporting.
3. The **health block** of every service involved — `store`, `disabled`, and the counters, which
   is the cold/dead/not-shared diagnosis in one paste.
4. What you **expected the entry to be** versus what it was — the part only you can supply.

If the report shows `removed 0` anywhere, say so — that line is the smoking gun of a dead
invalidation, and it never appears unless someone grepped for it.