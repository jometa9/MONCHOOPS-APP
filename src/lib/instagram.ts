export function normaliseUsernameInput(raw: string): string {
  let s = raw.trim();
  const urlMatch = s.match(/(?:instagram\.com|ig\.me)\/([A-Za-z0-9._]+)/i);
  if (urlMatch && urlMatch[1]) s = urlMatch[1];
  return s.replace(/^[@#]+/, '').replace(/[/?#].*$/, '').trim();
}

export function normaliseHashtagInput(raw: string): string {
  let s = raw.trim();
  const urlMatch = s.match(/(?:instagram\.com|ig\.me)\/explore\/tags\/([A-Za-z0-9._]+)/i);
  if (urlMatch && urlMatch[1]) s = urlMatch[1];
  return s.replace(/^#+/, '').replace(/[/?#].*$/, '').trim();
}
