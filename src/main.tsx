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
        navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .then(async (registration) => {
            // Register Background Sync if supported
            if ('sync' in registration) {
              try {
                await (
                  registration as ServiceWorkerRegistration & {
                    sync: { register: (tag: string) => Promise<void> };
                  }
                ).sync.register('elimikapdf-sync-vault');
              } catch {
                // Ignore if background sync permission is not granted yet
              }
            }

            // Register Periodic Background Sync if supported
            if ('periodicSync' in registration) {
              try {
                await (
                  registration as ServiceWorkerRegistration & {
                    periodicSync: {
                      register: (tag: string, options: { minInterval: number }) => Promise<void>;
                    };
                  }
                ).periodicSync.register('elimikapdf-periodic-sync', {
                  minInterval: 24 * 60 * 60 * 1000,
                });
              } catch {
                // Ignore if periodic sync permission is not granted yet
              }
            }
          })
          .catch(() => {
            // Ignore service worker registration errors in restricted preview frames
          });
      });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
