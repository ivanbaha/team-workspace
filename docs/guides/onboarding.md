# Onboarding

Welcome. This guide gets a new team member to a working local development environment.

---

## Prerequisites

- Node.js 20+
- Yarn 4+ (`corepack enable && corepack prepare yarn@stable --activate`)
- Docker (for running backing services)
- Git

---

## Step 1 — Clone the Repository

```bash
git clone git@github.com:your-org/team-workspace.git
cd team-workspace
```

---

## Step 2 — Install Dependencies

```bash
yarn install
```

This installs dependencies for all workspaces.

---

## Step 2b — Build the Shared Libraries

```bash
yarn build:libs
```

The three tracing libraries (`@tw/tracing`, `@tw/logger`, `@tw/http-connector`) are TypeScript and
build to `dist/`, which the backend services consume. **Run this once after `yarn install`** — a
service will fail to start with missing type declarations otherwise.

Build order matters and the script handles it: `tracing` → `logger` → `http-connector`.

---

## Step 3 — Configure Environment Variables

Each service has a `.env.example`. Copy and fill in values:

```bash
cp backend/users-service/.env.example backend/users-service/.env
cp backend/products-service/.env.example backend/products-service/.env
```

---

## Step 4 — Start Services

```bash
# Terminal 1 — Users backend
yarn dev:users-be

# Terminal 2 — Products backend
yarn dev:products-be

# Terminal 3 — Users frontend microfrontend
yarn dev:users-fe

# Terminal 4 — Products frontend microfrontend
yarn dev:products-fe

# Terminal 5 — Host frontend
yarn dev:host
```

Open `http://localhost:3000` in your browser.

---

## Step 5 — See a Request Traced Across Services

Worth doing once on day one, because it is the first thing you will reach for when something breaks.

Every request carries an `x-trace-id`, every service logs it, and you can supply your own:

```bash
TOKEN=$(curl -s -X POST http://localhost:4001/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"alice@example.com"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')

curl -s "http://localhost:4002/v1/products?expandOwner=true" \
  -H "Authorization: Bearer $TOKEN" -H 'x-trace-id: MY-FIRST-TRACE' > /dev/null
```

Now grep both backend terminals for `MY-FIRST-TRACE`. You will see products-service receive the
request, call users-service once per product, and users-service log its side under the same id —
with `caller=products-service` on each one.

In a deployed environment the same id goes into a single Grafana query. See
[Tracing a Request](./tracing-a-request.md).

---

## Key Links

- [Architecture](../architecture/architecture.md)
- [API Contracts](../architecture/api-contracts.md)
- [Distributed Tracing](../architecture/distributed-tracing.md) — how tracing works and what it gives up
- [Tracing a Request](./tracing-a-request.md) — the debugging runbook
- [Frontend overview](../../frontend/README.md)
- [Backend overview](../../backend/README.md)
