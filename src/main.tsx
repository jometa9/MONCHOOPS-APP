import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initI18n } from '@/lib/i18n';

initI18n();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
