# users-frontend

Microfrontend for the Users domain. Handles user authentication views, profile management, and account settings.

This app is consumed by [host-frontend](../host-frontend/README.md) via Module Federation at runtime.

---

## Responsibilities

- Login and registration pages
- User profile page
- Account settings page

## Tech Stack

- React 18
- React Router (scoped, routes handed to host at registration)
- Module Federation (Webpack 5)

---

## Source Structure

```txt
src/
  App.jsx          — Root component, exposes mount function
  pages/
    LoginPage.jsx
    ProfilePage.jsx
    SettingsPage.jsx
  components/
    UserCard.jsx
```

---

## Development

```bash
yarn install
yarn dev         # starts dev server on port 3001
```

The microfrontend runs standalone on port `3001`. When loaded by the host, it is mounted into the host's router.

---

## Exposed Module Federation Entry

```js
exposes:
  './App': './src/App'
```
