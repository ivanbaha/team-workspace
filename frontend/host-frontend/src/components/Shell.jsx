import React from 'react';
import Header from './Header';
import Sidebar from './Sidebar';

export default function Shell({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <div style={{ display: 'flex', flex: 1 }}>
        <Sidebar />
        <main style={{ flex: 1, padding: '1.5rem' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
