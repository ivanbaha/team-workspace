import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './state/store';
import Shell from './components/Shell';
import AppRoutes from './routes';

export default function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <Shell>
          <AppRoutes />
        </Shell>
      </BrowserRouter>
    </Provider>
  );
}
