# users-service

REST API for the Users domain. Manages user accounts, authentication tokens, and profile data.

---

## Endpoints

| Method | Path           | Description                    |
| ------ | -------------- | ------------------------------ |
| GET    | /health        | Health check                   |
| POST   | /auth/register | Register a new user            |
| POST   | /auth/login    | Authenticate and receive a JWT |
| GET    | /users/:id     | Get user profile by ID         |
| PUT    | /users/:id     | Update user profile            |
| DELETE | /users/:id     | Delete user account            |

Full API contract: [docs/api-contracts.md](../../docs/api-contracts.md)

---

## Tech Stack

- Node.js + Express
- JSON Web Tokens (JWT) for authentication
- In-memory store (demo; swap for a real DB in production)

---

## Source Structure

```txt
src/
  index.js          — Entry point, starts HTTP server
  app.js            — Express app factory
  routes/
    auth.js         — /auth routes
    users.js        — /users routes
  middleware/
    auth.js         — JWT verification middleware
  data/
    users.js        — In-memory users store (demo)
```

---

## Development

```bash
yarn install
yarn dev       # starts on port 4001 with nodemon
```

Environment variables:

| Variable   | Default  | Description             |
| ---------- | -------- | ----------------------- |
| PORT       | 4001     | HTTP port               |
| JWT_SECRET | changeme | Secret for signing JWTs |
