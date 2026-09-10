import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/router';
import { initTheme } from '@/lib/theme';
import '@/styles/app.css';

initTheme();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing from index.html');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
