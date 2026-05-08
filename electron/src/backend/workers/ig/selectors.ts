

export const SELECTORS = {

  loginUsername: 'input[name="username"]',
  loginPassword: 'input[name="password"]',
  loginSubmit: 'button[type="submit"]',

  captcha: '#captcha-recaptcha, iframe[src*="recaptcha" i], iframe[title*="reCAPTCHA" i]',

  postLinkAnchor: 'a[href*="/p/"]',
  reelLinkAnchor: 'a[href*="/reel/"]',
  reelsTabAnchor: (username: string) => `a[href$="/${username}/reels/"]`,
  postsTabAnchor: (username: string) => `a[href$="/${username}/"]`,
  followersLinkAnchor: (username: string) => `a[href$="/${username}/followers/"]`,
  followingLinkAnchor: (username: string) => `a[href$="/${username}/following/"]`,

  likedByLinkAnchor: 'a[href$="/liked_by/"]',
  postTime: 'time[datetime]',
  commentList: 'ul[role="list"]',
  dialog: 'div[role="dialog"]',
};

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
