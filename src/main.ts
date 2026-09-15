import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('app-root');
if (!container) throw new Error('Application root #app-root is missing');
createRoot(container).render(createElement(StrictMode, null, createElement(App)));
