import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'MonchoOps — Cold DM',
  short_name: 'MonchoOps',
  description: 'Schedule cold DMs on the Instagram account already logged into your browser.',
  version: pkg.version,
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      '16': 'icons/icon-black-16.png',
      '32': 'icons/icon-black-32.png',
      '48': 'icons/icon-black-48.png',
      '128': 'icons/icon-black-128.png',
    },
    theme_icons: [
      { size: 16, light: 'icons/icon-black-16.png', dark: 'icons/icon-white-16.png' },
      { size: 32, light: 'icons/icon-black-32.png', dark: 'icons/icon-white-32.png' },
    ],
  },
  icons: {
    '16': 'icons/icon-black-16.png',
    '32': 'icons/icon-black-32.png',
    '48': 'icons/icon-black-48.png',
    '128': 'icons/icon-black-128.png',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.instagram.com/*', 'https://ig.me/*'],
      js: ['src/content/content.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: [
    'storage',
    'alarms',
    'tabs',
    'scripting',
    'cookies',
    'notifications',
  ],
  host_permissions: [
    'https://www.instagram.com/*',
    'https://ig.me/*',
    'https://b2dm.app/*',
    'http://127.0.0.1:17775/*',
    'http://127.0.0.1:17776/*',
    'http://127.0.0.1:17777/*',
    'http://127.0.0.1:17778/*',
    'http://127.0.0.1:17779/*',
    'http://127.0.0.1:17780/*',
  ],
  web_accessible_resources: [
    {
      resources: ['src/dashboard/index.html'],
      matches: ['<all_urls>'],
    },
  ],
});
