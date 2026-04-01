import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

/**
 * In a real Module Federation setup, the import below is replaced by:
 *   const UsersApp = lazy(() => import('usersFrontend/App'));
 *
 * For this demo, we import the placeholder directly.
 */
const UsersApp = lazy(() => import('../../users-frontend/src/App'));

function UsersLoading() {
  return <p>Loading Users module...</p>;
}

export default function UsersRoutes() {
  return (
    <Suspense fallback={<UsersLoading />}>
      <Routes>
        <Route path="/*" element={<UsersApp />} />
      </Routes>
    </Suspense>
  );
}
