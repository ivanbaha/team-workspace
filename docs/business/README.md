# Business Domain & Flows

Descriptions of business flows, domain processes, and microservice interactions
from the user's perspective. This is the blueprint for understanding what the
project is *for* — the part that is not derivable from reading the code.

These documents are part of the [`docs_search` corpus](../architecture/docs-rag.md),
so an agent asked "what happens when a price changes mid-checkout?" finds the
flow rather than reverse-engineering it from two services.

## Contents

- [Checkout Flow](./checkout-flow.md) — Basket to confirmed order, stage by stage,
  and which service owns each step.

## Writing a flow document

Flows are cross-service by definition — that is why they cannot live in a
service README. A useful flow document answers:

- **Which service owns each stage**, so a failure can be routed without a search.
- **How each stage fails**, and whether that failure is an error or an expected
  outcome with its own UI.
- **Why the sequence is what it is.** The ordering constraints are the part that
  gets silently broken during a refactor.
