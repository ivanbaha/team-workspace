import React from 'react';
import { Routes, Route } from 'react-router-dom';

function Dashboard() {
  return (
    <section>
      <h1>Dashboard</h1>
      <p>Welcome to the Team App. Use the sidebar to navigate between domains.</p>
    </section>
  );
}

function Settings() {
  return (
    <section>
      <h1>Application Settings</h1>
      <p>Global configuration options for the host application.</p>
    </section>
  );
}

export default function HostRoutes() {
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="settings" element={<Settings />} />
    </Routes>
  );
}
