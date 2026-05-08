import { validateLicense } from './license';
import type { SessionSnapshot } from './types';

export async function handleAuthDeepLink(url: string): Promise<SessionSnapshot | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'monchoops:') return null;
  if (parsed.hostname !== 'auth' && parsed.pathname !== '/auth') return null;

  const apiKey = parsed.searchParams.get('apiKey') ?? parsed.searchParams.get('token');
  if (!apiKey) return null;

  return validateLicense(apiKey);
}
