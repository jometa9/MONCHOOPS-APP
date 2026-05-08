import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';

import '@/dashboard/theme';
import { Popup } from './Popup';
import { initI18n } from '@/shared/i18n';

void (async () => {
  await initI18n();
  const el = document.getElementById('root');
  if (el) createRoot(el).render(<React.StrictMode><Popup /></React.StrictMode>);
})();
