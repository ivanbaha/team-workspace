import React from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { clearCredentials } from '../state/authSlice';

export default function Header() {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.auth.user);

  function handleLogout() {
    dispatch(clearCredentials());
  }

  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem', height: '56px', borderBottom: '1px solid #e5e7eb' }}>
      <Link to="/" style={{ fontWeight: 600, textDecoration: 'none' }}>
        Team App
      </Link>

      <div>
        {user ? (
          <span>
            {user.name}
            {' — '}
            <button type="button" onClick={handleLogout}>
              Log out
            </button>
          </span>
        ) : (
          <Link to="/users/login">Log in</Link>
        )}
      </div>
    </header>
  );
}
