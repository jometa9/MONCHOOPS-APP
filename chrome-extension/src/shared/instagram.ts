

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

  return { loggedIn: true, username: null };
}
