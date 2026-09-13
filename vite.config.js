import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Config-sync crypto/eval is vendored under src/lib/config-sync (works in Docker).
 * Re-sync from the JS SDK with: npm run sync:config-sync
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@flagmint/config-sync': path.resolve(__dirname, 'src/lib/config-sync'),
    },
  },
  optimizeDeps: {
    include: [
      '@noble/curves/ed25519.js',
      '@noble/hashes/hkdf.js',
      '@noble/hashes/sha2.js',
      '@noble/hashes/utils.js',
      '@noble/hashes/hmac.js',
    ],
  },
  server: {
    port: 5173,
    open: false,
  },
});
