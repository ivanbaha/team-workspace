import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installTraceInterceptor } from './tracing/install-trace-interceptor';

// Before any remote is mounted: remotes share this `window`, and the patch must not be stacked.
installTraceInterceptor([process.env.API_ORIGIN ?? window.location.origin]);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
