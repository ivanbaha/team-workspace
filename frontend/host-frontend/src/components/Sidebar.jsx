import React from 'react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/users', label: 'Users' },
  { to: '/products', label: 'Products' },
  { to: '/settings', label: 'Settings' },
];

export default function Sidebar() {
  return (
    <nav style={{ width: '200px', borderRight: '1px solid #e5e7eb', padding: '1rem 0' }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {navItems.map(({ to, label, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              style={({ isActive }) => ({
                display: 'block',
                padding: '0.5rem 1.25rem',
                textDecoration: 'none',
                fontWeight: isActive ? 600 : 400,
                background: isActive ? '#f3f4f6' : 'transparent',
              })}
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
