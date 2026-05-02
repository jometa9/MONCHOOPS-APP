// Read-only check for whether the user has an active Instagram session in
// this Chrome profile. The extension never logs the user in — it just uses
// whatever session is already there. If sessionid is missing, we tell the
// user to log into IG manually before campaigns can run.

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

  // ds_user_id alone doesn't give us the @handle, but it confirms there's a
  // user behind the session. The handle is stored in another cookie called
  // ig_did / csrftoken and isn't reliably the username — so we leave it null
  // unless we read it from the page itself.
  return { loggedIn: true, username: null };
}
