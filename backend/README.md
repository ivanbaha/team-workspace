# Backend

All server-side services. Each service is a standalone Node.js application with its own database connection, API surface, and deployment lifecycle.

---

## Services

- [users-service](./users-service/README.md) — REST API managing user accounts, authentication tokens, and profile data
- [products-service](./products-service/README.md) — REST API managing product catalogue, inventory, and pricing

---

## Conventions

- HTTP framework: Express
- All services expose health endpoints at `GET /health`
- Environment variables are documented in each service's `.env.example`
- API contracts are described in [docs/api-contracts.md](../docs/api-contracts.md)

---

## Development

```bash
# From workspace root
yarn dev:users-be
yarn dev:products-be
```
