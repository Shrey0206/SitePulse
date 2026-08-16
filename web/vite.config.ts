import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxying keeps dev on a single origin, so the httpOnly SameSite=Strict refresh
    // cookie stays first-party exactly as it does in production, where Express serves the
    // built frontend itself (DECISIONS.md #18). Without this, dev would need SameSite=None
    // and a CSRF scheme that production doesn't.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
