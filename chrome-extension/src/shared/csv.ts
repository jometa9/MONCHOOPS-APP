

import Papa from 'papaparse';

export interface CsvLead {
  username: string;
  displayName: string;
}

export function normaliseUsernameInput(raw: string): string {
  let s = raw.trim();
  const urlMatch = s.match(/(?:instagram\.com|ig\.me)\/([A-Za-z0-9._]+)/i);
  if (urlMatch && urlMatch[1]) s = urlMatch[1];
  return s.replace(/^[@#]+/, '').replace(/[/?#].*$/, '').trim();
}

export function parseUsernamesText(raw: string): CsvLead[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines[0]?.toLowerCase();
  const withoutHeader =
    first && (first === 'username' || first.startsWith('username,')) ? lines.slice(1) : lines;
  const seen = new Set<string>();
  const out: CsvLead[] = [];
  for (const line of withoutHeader) {
    const parsed = Papa.parse<string[]>(line, { header: false });
    const cell = parsed.data[0]?.[0] ?? line.split(',')[0] ?? '';
    const display = normaliseUsernameInput(cell);
    if (!display) continue;
    const lower = display.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push({ username: lower, displayName: display });
  }
  return out;
}

export async function parseUsernamesFile(file: File): Promise<CsvLead[]> {
  const text = await file.text();
  return parseUsernamesText(text);
}
