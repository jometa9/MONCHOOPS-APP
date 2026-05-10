

export async function getIgSessionState(): Promise<{
  loggedIn: boolean;
  username: string | null;
}> {
  let sessionid: chrome.cookies.Cookie | null = null;
  try {
    sessionid = await chrome.cookies.get({
      url: 'https://www.instagram.com',
      name: 'sessionid',
    });
  } catch {
    sessionid = null;
  }
  if (!sessionid?.value) return { loggedIn: false, username: null };

  const username = await getCurrentIgUsername();
  return { loggedIn: true, username };
}

export async function getCurrentIgUsername(): Promise<string | null> {
  try {
    const res = await fetch('https://i.instagram.com/api/v1/accounts/current_user/', {
      headers: { 'X-IG-App-ID': '936619743392459' },
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { username?: string } };
    const u = data.user?.username;
    return typeof u === 'string' && u.length > 0 ? u : null;
  } catch {
    return null;
  }
}
