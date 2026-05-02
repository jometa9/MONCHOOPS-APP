import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { Popup } from './Popup';

const el = document.getElementById('root');
if (el) createRoot(el).render(<React.StrictMode><Popup /></React.StrictMode>);
