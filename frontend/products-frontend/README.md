# products-frontend

Microfrontend for the Products domain. Renders the product catalogue, individual product detail pages, and search results.

This app is consumed by [host-frontend](../host-frontend/README.md) via Module Federation at runtime.

---

## Responsibilities

- Product catalogue / listing page
- Product detail page
- Search and filter UI

## Tech Stack

- React 18
- React Router (scoped)
- Module Federation (Webpack 5)

---

## Source Structure

```txt
src/
  App.jsx          — Root component, exposes mount function
  pages/
    CataloguePage.jsx
    ProductDetailPage.jsx
    SearchPage.jsx
  components/
    ProductCard.jsx
```

---

## Development

```bash
yarn install
yarn dev         # starts dev server on port 3002
```

---

## Exposed Module Federation Entry

```js
exposes:
  './App': './src/App'
```
