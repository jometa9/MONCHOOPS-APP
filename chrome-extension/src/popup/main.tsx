import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
// Side-effect import: applies the user's stored light/dark choice (shared
// with the dashboard via localStorage on the extension origin) to the popup.
import '@/dashboard/theme';
import { Popup } from './Popup';
import { initI18n } from '@/shared/i18n';

void (async () => {
  await initI18n();
  const el = document.getElementById('root');
  if (el) createRoot(el).render(<React.StrictMode><Popup /></React.StrictMode>);
})();
