import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run build` writes to ../dist, which server.js serves.
// `npm run dev` gives live reload and passes /api calls to server.js.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: path.join(import.meta.dirname, '..', 'dist'), emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
