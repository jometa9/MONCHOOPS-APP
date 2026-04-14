import { validateLicense } from './license';
import type { SessionSnapshot } from './types';

// Google-sign-in flow closes with a redirect to `b2dm://auth?apiKey=…`
// (the dashboard issues a real license key once it has verified the Google
// identity). We extract the key, validate it the normal way, and emit a
// fresh SessionSnapshot.
//
// Any other b2dm:// payload is ignored here — it's handled by the renderer
// (e.g. deep links into specific screens).
export async function handleAuthDeepLink(url: string): Promise<SessionSnapshot | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'b2dm:') return null;
  if (parsed.hostname !== 'auth' && parsed.pathname !== '/auth') return null;

  const apiKey = parsed.searchParams.get('apiKey') ?? parsed.searchParams.get('token');
  if (!apiKey) return null;

  return validateLicense(apiKey);
}
