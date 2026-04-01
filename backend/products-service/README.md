# products-service

REST API for the Products domain. Manages product catalogue, inventory levels, and pricing.

---

## Endpoints

| Method | Path          | Description                                          |
| ------ | ------------- | ---------------------------------------------------- |
| GET    | /health       | Health check                                         |
| GET    | /products     | List all products (supports ?search= and ?category=) |
| GET    | /products/:id | Get product by ID                                    |
| POST   | /products     | Create a new product                                 |
| PUT    | /products/:id | Update a product                                     |
| DELETE | /products/:id | Delete a product                                     |

Full API contract: [docs/api-contracts.md](../../docs/api-contracts.md)

---

## Tech Stack

- Node.js + Express
- In-memory store (demo; swap for a real DB in production)

---

## Source Structure

```txt
src/
  index.js          — Entry point, starts HTTP server
  app.js            — Express app factory
  routes/
    products.js     — /products routes
  middleware/
    auth.js         — JWT verification middleware (validates tokens issued by users-service)
  data/
    products.js     — In-memory products store (demo)
```

---

## Development

```bash
yarn install
yarn dev       # starts on port 4002 with nodemon
```

Environment variables:

| Variable   | Default  | Description                  |
| ---------- | -------- | ---------------------------- |
| PORT       | 4002     | HTTP port                    |
| JWT_SECRET | changeme | Same secret as users-service |
