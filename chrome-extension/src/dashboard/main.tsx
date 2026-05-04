import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@/styles/globals.css';
import './theme';
import { App } from './App';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>
  );
}
