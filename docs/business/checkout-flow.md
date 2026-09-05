# Checkout Flow

How an order gets from a full basket to a confirmed purchase, and which service
owns each step.

---

## Overview

Checkout spans both backend services and the host frontend. No single service
owns the whole flow, which is why this document exists: the sequence is only
visible here.

```
host-frontend ──► users-service      (identity, addresses, payment methods)
      │
      └────────► products-service    (price + availability re-check)
                        │
                        └──► order created ──► confirmation
```

## Stages

| # | Stage | Owner | Fails how |
|---|---|---|---|
| 1 | Basket review | `host-frontend` | Client-side only; no server state yet |
| 2 | Identity check | `users-service` | 401 → redirect to sign-in, basket preserved |
| 3 | Address selection | `users-service` | 422 if the address is outside the served market area |
| 4 | Price + availability re-check | `products-service` | 409 if price or stock moved since the basket was filled |
| 5 | Order creation | `products-service` | 500 → basket preserved, nothing charged |
| 6 | Confirmation | `host-frontend` | — |

## Why stage 4 exists

The basket is client state and can be hours old. Prices and stock move
independently of it. Re-checking at checkout rather than trusting the basket is
what prevents the two failures users actually notice: being charged a stale
price, and buying something that is no longer in stock.

A 409 at this stage is **not an error state** in the UI. It is an expected
outcome that re-renders the basket with the changed lines highlighted, and asks
for confirmation again.

## Market-area scoping

Every stage is scoped to the user's market area. A user in one market area can
never see, price, or order a product from another. The constraint is applied
**in the query** at each stage, never as a filter on results.

The distinction matters: a post-filter means the database ranks and paginates
over documents the user may not see, so a page of results can arrive
short — or empty — while later pages have content, and the total count is wrong
in a way that stays invisible until a user complains.

## Idempotency

Order creation accepts an `Idempotency-Key` header. A retried request with the
same key returns the original order rather than creating a second one. Clients
**must** send it: a double-submitted checkout without a key creates two orders,
and the user sees one.

See [API Contracts](../architecture/api-contracts.md) for the header conventions.
