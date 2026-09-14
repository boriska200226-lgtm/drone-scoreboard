import * as React from 'react';
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorker } from './guild/pwa'

createRoot(document.getElementById("root")!).render(<App />);

// PWA: без Service Worker не будет ни офлайна, ни установки на устройство.
registerServiceWorker();
