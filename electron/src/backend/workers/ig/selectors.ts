// Centralized DOM selectors for Instagram pages. Selectors rely on stable
// href patterns / ARIA roles rather than localized copy so they keep working
// across IG A/B tests and language changes.

export const SELECTORS = {
  // Login page
  loginUsername: 'input[name="username"]',
  loginPassword: 'input[name="password"]',
  loginSubmit: 'button[type="submit"]',

  // Captcha — IG sometimes drops in reCAPTCHA Enterprise on auto-logins.
  captcha: '#captcha-recaptcha, iframe[src*="recaptcha" i], iframe[title*="reCAPTCHA" i]',

  // Profile grid / tabs
  postLinkAnchor: 'a[href*="/p/"]',
  reelLinkAnchor: 'a[href*="/reel/"]',
  reelsTabAnchor: (username: string) => `a[href$="/${username}/reels/"]`,
  postsTabAnchor: (username: string) => `a[href$="/${username}/"]`,
  followersLinkAnchor: (username: string) => `a[href$="/${username}/followers/"]`,
  followingLinkAnchor: (username: string) => `a[href$="/${username}/following/"]`,

  // Post / reel detail
  likedByLinkAnchor: 'a[href$="/liked_by/"]',
  postTime: 'time[datetime]',
  commentList: 'ul[role="list"]',
  dialog: 'div[role="dialog"]',
};

// These path segments are IG app routes, not usernames. When extracting
// usernames from anchors we skip them.
export const RESERVED_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'direct',
  'accounts',
  'stories',
  'tv',
  'challenge',
  'about',
  'legal',
  'press',
  'terms',
  'privacy',
]);
