import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // During `vite dev`, forward /api calls to `wrangler pages dev` (default port 8788)
      // so the Cloudflare Pages Function proxy can be exercised locally.
      '/api': 'http://127.0.0.1:8788',
    },
  },
});
