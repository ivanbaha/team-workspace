import { CACHE_NAMESPACES } from '@tw/cache';

// The queue and the batch lock are not entity entries — they have no id, so `cacheKey()` does not
// apply — but their prefix still comes from the registry rather than a string literal, so the cache
// server's ACL rule ("this service may write only its own prefix") covers them too. One key-helper
// module per service; the entity half of this service's keys lives in the shared registry.
const SERVICE_PREFIX = CACHE_NAMESPACES.categoryStats.service;

/** Redis Set holding category ids awaiting recomputation. The set IS the queue: SPOP drains it. */
export const QUEUE_KEY = `${SERVICE_PREFIX}_queue`;

/** SET NX EX lock guarding the decision to schedule a batch. The TTL is the release. */
export const LOCK_KEY = `${SERVICE_PREFIX}_batch-lock`;