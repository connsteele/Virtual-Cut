import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';

export default defineConfig(({ command }) => {
  // Vite's React refresh preamble is an inline development script. A fresh
  // server nonce permits that preamble without allowing arbitrary inline JS.
  // The production bundle has no inline script and uses main's stricter CSP.
  const nonce = command === 'serve' ? randomBytes(24).toString('base64') : undefined;
  return {
    plugins: [react()],
    html: nonce ? { cspNonce: nonce } : undefined,
    base: './',
    build: {
      outDir: 'dist',
      target: 'es2022',
      sourcemap: false,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      headers: {
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:5173; media-src 'self' media://video; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'`,
      },
    },
  };
});
