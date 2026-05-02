// Username CSV parser. Accepts files where the first column is the
// username, with or without a header row. Strips leading "@" and lowercases
// for dedup. Mirrors parseUsernamesCsv() from the desktop massDm worker.

import Papa from 'papaparse';

export interface CsvLead {
  username: string;
  displayName: string;
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
    const display = cell.trim().replace(/^@+/, '');
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
