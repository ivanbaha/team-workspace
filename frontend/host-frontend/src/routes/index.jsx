import React from 'react';
import { Routes, Route } from 'react-router-dom';
import HostRoutes from './HostRoutes';
import UsersRoutes from './UsersRoutes';
import ProductsRoutes from './ProductsRoutes';
import NotFound from '../components/NotFound';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/*" element={<HostRoutes />} />
      <Route path="/users/*" element={<UsersRoutes />} />
      <Route path="/products/*" element={<ProductsRoutes />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
