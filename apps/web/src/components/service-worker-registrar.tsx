'use client';

import { useEffect } from 'react';

/**
 * Registers the offline service worker.
 *
 * The PWA shell is what makes the web app usable on a plane: cached pages and
 * queued mutations keep working, and the queue drains when the connection
 * returns. It is registered from the client so a failed registration can never
 * break server rendering.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('offline support is unavailable:', error);
      });
    };
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
