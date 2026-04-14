import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  root: __dirname,
  base: mode === 'development' ? '/' : './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 7775,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/electron/dist/**',
        '**/release/**',
        '**/userData/**',
        '**/.git/**',
      ],
    },
  },
}));
