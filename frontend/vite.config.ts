import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bound to every interface so a phone on the same Wi-Fi can open the guest
    // screens and scan the table codes. The /api proxy keeps the backend local.
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Two entries, two installable apps: guests get /, the whole staff team shares
    // /staff.html, which carries its own manifest and name on the home screen.
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        staff: `${root}staff.html`,
      },
    },
  },
});
