import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import fs from 'node:fs';
import manifest from './manifest.config';

function copyThemeIcons(): Plugin {
  return {
    name: 'copy-theme-icons',
    apply: 'build',
    closeBundle() {
      const src = path.resolve(__dirname, 'icons');
      const dest = path.resolve(__dirname, 'dist/icons');
      fs.mkdirSync(dest, { recursive: true });
      for (const file of fs.readdirSync(src)) {
        if (file.startsWith('icon-white-')) {
          fs.copyFileSync(path.join(src, file), path.join(dest, file));
        }
      }
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [react(), crx({ manifest }), copyThemeIcons()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5174,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: path.resolve(__dirname, 'src/dashboard/index.html'),
      },
    },
  },
});
