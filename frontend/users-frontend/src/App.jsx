import React from 'react';

export default function App() {
  return (
    <div>
      <h1>Users Microfrontend</h1>
      <nav>
        <a href="/users/login">Login</a>
        {' | '}
        <a href="/users/profile">Profile</a>
        {' | '}
        <a href="/users/settings">Settings</a>
      </nav>
    </div>
  );
}
