import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

/**
 * In a real Module Federation setup, the import below is replaced by:
 *   const ProductsApp = lazy(() => import('productsFrontend/App'));
 *
 * For this demo, we import the placeholder directly.
 */
const ProductsApp = lazy(() => import('../../products-frontend/src/App'));

function ProductsLoading() {
  return <p>Loading Products module...</p>;
}

export default function ProductsRoutes() {
  return (
    <Suspense fallback={<ProductsLoading />}>
      <Routes>
        <Route path="/*" element={<ProductsApp />} />
      </Routes>
    </Suspense>
  );
}
