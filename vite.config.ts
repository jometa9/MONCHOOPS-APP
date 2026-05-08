import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import obfuscator from 'vite-plugin-javascript-obfuscator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  root: __dirname,
  base: mode === 'development' ? '/' : './',
  plugins: [
    react(),
    ...(mode === 'production'
      ? [
          obfuscator({
            apply: 'build',
            options: {
              compact: true,
              simplify: true,
              target: 'browser',
              identifierNamesGenerator: 'hexadecimal',
              renameGlobals: false,
              transformObjectKeys: false,
              stringArray: true,
              stringArrayThreshold: 0.75,
              stringArrayEncoding: ['base64'],
              stringArrayIndexShift: true,
              stringArrayRotate: true,
              stringArrayShuffle: true,
              stringArrayWrappersCount: 2,
              stringArrayWrappersChainedCalls: true,
              stringArrayWrappersParametersMaxCount: 4,
              stringArrayWrappersType: 'function',
              splitStrings: true,
              splitStringsChunkLength: 8,
              unicodeEscapeSequence: true,
              numbersToExpressions: true,
              controlFlowFlattening: false,
              deadCodeInjection: false,
              selfDefending: false,
              debugProtection: false,
              disableConsoleOutput: false,
              sourceMap: false,
            },
          }),
        ]
      : []),
  ],
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
