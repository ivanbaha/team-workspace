import React from 'react';

export default function App() {
  return (
    <div>
      <h1>Products Microfrontend</h1>
      <nav>
        <a href="/products">Catalogue</a>
        {' | '}
        <a href="/products/search">Search</a>
      </nav>
    </div>
  );
}
