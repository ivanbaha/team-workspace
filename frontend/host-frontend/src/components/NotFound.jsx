import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section style={{ padding: '2rem' }}>
      <h1>404 — Page Not Found</h1>
      <p>The page you are looking for does not exist.</p>
      <Link to="/">Return to Dashboard</Link>
    </section>
  );
}
