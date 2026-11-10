import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) {
          if (registration.active?.scriptURL.includes('dev-sw.js')) {
            registration.unregister();
          }
        }
      })
      .finally(() => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
          // Ignore service worker registration errors in restricted preview frames
        });
      });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
