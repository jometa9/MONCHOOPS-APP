import fs from 'fs';
import path from 'path';

function readAppVersion(): string {

  try {
    const p = path.resolve(__dirname, '..', '..', 'package.json');
    if (fs.existsSync(p)) {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    }
  } catch {}
  return '0.0.0';
}

export const BUILD_CONFIG = {
  APP_VERSION: readAppVersion(),
  FRONTEND_PORT: 7775,
  PROTOCOL: 'b2dm',
  PRODUCT_NAME: 'B2DM',
  LICENSE_API_BASE: 'https://b2dm.app',
  DASHBOARD_URL: 'https://b2dm.app/dashboard',
  BILLING_URL: 'https://b2dm.app/dashboard/billing',
  GOOGLE_LOGIN_URL: 'https://b2dm.app/login/google?callback=b2dm://auth',
} as const;
