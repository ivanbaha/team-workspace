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

## Key Links

- [Architecture](./architecture.md)
- [API Contracts](./api-contracts.md)
- [Frontend overview](../frontend/README.md)
- [Backend overview](../backend/README.md)
