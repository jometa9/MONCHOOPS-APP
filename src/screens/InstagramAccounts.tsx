import { useEffect, useMemo, useState } from 'react';
import { Globe, Instagram, Loader2, Plus, Search, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { useAccounts } from '@/context/AccountsContext';
import { b2dm } from '@/lib/b2dm';
import type { AccountPublic } from '@/types/domain';

type StatusFilter = 'all' | AccountPublic['status'];

function StatusBadge({ status }: { status: AccountPublic['status'] }) {
  if (status === 'busy') return <Badge variant="warning">Running</Badge>;
  if (status === 'error') return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="success">Idle</Badge>;
}

function AccountRow({
  account,
  onDelete,
  onConfigureProxy,
}: {
  account: AccountPublic;
  onDelete: () => void;
  onConfigureProxy: () => void;
}) {
  return (
    <tr className="border-t border-border even:bg-muted/30 last:border-b hover:bg-accent/40">
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2.5">
          {account.profilePicUrl ? (
            <img
              src={account.profilePicUrl}
              alt={account.username}
              className="h-6 w-6 flex-none rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Instagram className="h-3 w-3" />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium leading-tight">@{account.username}</div>
            {account.displayName ? (
              <div className="truncate text-[11px] leading-tight text-muted-foreground">
                {account.displayName}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-3 py-1.5">
        <StatusBadge status={account.status} />
      </td>
      <td className="px-3 py-1.5">
        {account.proxyUrl ? (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs">
              <Globe className="h-3 w-3 flex-none text-muted-foreground" />
              <span className="truncate font-mono">{account.proxyUrl}</span>
            </div>
            {account.proxyUsername ? (
              <div className="truncate pl-[18px] text-[11px] text-muted-foreground">
                {account.proxyUsername}
                {account.hasProxyPassword ? ' · ••••' : ''}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Direct connection</span>
        )}
      </td>
      <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground">
        {new Date(account.updatedAt).toLocaleDateString()}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={onConfigureProxy}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Configure proxy"
            aria-label="Configure proxy"
          >
            <Globe className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={account.status === 'busy'}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            title="Delete account"
            aria-label="Delete account"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'idle', label: 'Idle' },
  { value: 'busy', label: 'Running' },
  { value: 'error', label: 'Error' },
];

function ProxyDialog({
  account,
  onClose,
}: {
  account: AccountPublic;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(account.proxyUrl ?? '');
  const [username, setUsername] = useState(account.proxyUsername ?? '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await b2dm.accounts.updateProxy({
        id: account.id,
        url: url.trim() || null,
        username: username.trim() || null,
        password: password.length > 0 ? password : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save proxy');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Configure proxy"
      description={`Route @${account.username}'s traffic through a custom proxy.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : null}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="proxy-url">Proxy URL</Label>
          <Input
            id="proxy-url"
            placeholder="http://host:port or socks5://host:port"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="proxy-user">Username (optional)</Label>
            <Input id="proxy-user" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proxy-pass">Password (optional)</Label>
            <Input
              id="proxy-pass"
              type="password"
              placeholder={account.hasProxyPassword ? '•••••••• (stored)' : ''}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  );
}

function ConfirmDeleteDialog({
  account,
  onClose,
}: {
  account: AccountPublic;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await b2dm.accounts.delete(account.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete @${account.username}?`}
      description="This removes the stored session from this device. You'll have to log in again if you want to use it later."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? 'Deleting…' : 'Delete account'}
          </Button>
        </>
      }
    >
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </Dialog>
  );
}

function LoginMethodDialog({
  onClose,
  onChooseManual,
  onChooseAuto,
}: {
  onClose: () => void;
  onChooseManual: () => void;
  onChooseAuto: (username: string, password: string) => void;
}) {
  const [choice, setChoice] = useState<'manual' | 'credentials'>('manual');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (choice === 'manual') {
      onChooseManual();
    } else {
      if (!username.trim() || !password.trim()) {
        setError('Please enter both username and password');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await onChooseAuto(username, password);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start login');
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Link Instagram Account"
      description="Choose how you want to sign in to your Instagram account."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleContinue} disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? 'Signing in…' : 'Continue'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer p-3 border border-border rounded-lg hover:bg-accent transition-colors" onClick={() => setChoice('manual')}>
            <input
              type="radio"
              name="login-method"
              value="manual"
              checked={choice === 'manual'}
              onChange={() => setChoice('manual')}
              className="w-4 h-4"
            />
            <div>
              <div className="font-medium">Manual Login</div>
              <div className="text-sm text-muted-foreground">A browser window will open for you to sign in</div>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer p-3 border border-border rounded-lg hover:bg-accent transition-colors" onClick={() => setChoice('credentials')}>
            <input
              type="radio"
              name="login-method"
              value="credentials"
              checked={choice === 'credentials'}
              onChange={() => setChoice('credentials')}
              className="w-4 h-4"
            />
            <div>
              <div className="font-medium">Use Username & Password</div>
              <div className="text-sm text-muted-foreground">We'll handle the login automatically</div>
            </div>
          </label>
        </div>

        {choice === 'credentials' && (
          <div className="space-y-3 mt-4 pt-4 border-t border-border">
            <div className="space-y-1">
              <Label htmlFor="username">Username or Email</Label>
              <Input
                id="username"
                placeholder="your.username or your.email@example.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
        )}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  );
}

interface BulkRow {
  username: string;
  password: string;
  proxyUrl?: string;
  proxyUsername?: string;
  proxyPassword?: string;
}

interface ParsedRow extends BulkRow {
  rowNumber: number;
  error?: string;
}

const BULK_TEMPLATE = 'username,password,proxy_url,proxy_username,proxy_password';

// Minimal CSV splitter: handles commas + double-quoted values. Embedded
// newlines inside quoted fields are not supported (we split by line first).
function splitCsvLine(line: string, rowNumber: number): ParsedRow {
  const fields: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        buf += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        buf += ch;
      }
    } else if (ch === ',') {
      fields.push(buf);
      buf = '';
    } else if (ch === '"' && buf.length === 0) {
      inQuotes = true;
    } else {
      buf += ch;
    }
  }
  fields.push(buf);

  const [username, password, proxyUrl, proxyUsername, proxyPassword] = fields.map((f) => f.trim());

  const row: ParsedRow = {
    rowNumber,
    username: username ?? '',
    password: password ?? '',
    proxyUrl: proxyUrl || undefined,
    proxyUsername: proxyUsername || undefined,
    proxyPassword: proxyPassword || undefined,
  };

  if (!row.username) row.error = 'Missing username';
  else if (!row.password) row.error = 'Missing password';
  else if (row.proxyUrl && !/^(https?|socks5):\/\/[^\s]+:\d+/.test(row.proxyUrl)) {
    row.error = 'Bad proxy URL format';
  }

  return row;
}

function parseBulkText(raw: string): ParsedRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const first = lines[0]!.toLowerCase();
  const hasHeader = /username/.test(first) && /password/.test(first);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line, i) => splitCsvLine(line, hasHeader ? i + 2 : i + 1));
}

function BulkLoginDialog({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (rows: BulkRow[]) => Promise<void>;
}) {
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setParsed(parseBulkText(text));
  }, [text]);

  async function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        setText(await file.text());
        return;
      }
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]!]!;
        setText(XLSX.utils.sheet_to_csv(sheet));
        return;
      }
      setError('Unsupported file type. Use .csv, .txt, .xlsx, or .xls');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read file');
    }
  }

  const validRows = useMemo(() => parsed.filter((r) => !r.error), [parsed]);
  const errorRows = useMemo(() => parsed.filter((r) => r.error), [parsed]);

  async function start() {
    if (validRows.length === 0) {
      setError('No valid rows to import');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onStart(
        validRows.map((r) => ({
          username: r.username,
          password: r.password,
          proxyUrl: r.proxyUrl,
          proxyUsername: r.proxyUsername,
          proxyPassword: r.proxyPassword,
        }))
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start bulk login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Bulk import accounts"
      description="Sign in to multiple Instagram accounts. Each row is processed sequentially in a hidden browser."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={start} disabled={busy || validRows.length === 0}>
            {busy ? <Spinner /> : null}
            {busy
              ? 'Starting…'
              : `Import ${validRows.length} ${validRows.length === 1 ? 'account' : 'accounts'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant={mode === 'paste' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('paste')}
            disabled={busy}
          >
            Paste CSV
          </Button>
          <Button
            variant={mode === 'file' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('file')}
            disabled={busy}
          >
            Upload .csv / .xlsx
          </Button>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="mb-1 font-medium">Expected columns (header optional):</div>
          <code className="block font-mono text-[11px] text-muted-foreground">{BULK_TEMPLATE}</code>
          <div className="mt-1 text-muted-foreground">
            Proxy fields are optional. Proxy URL must be{' '}
            <code>http://host:port</code> or <code>socks5://host:port</code>.
          </div>
        </div>

        {mode === 'paste' ? (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`username,password,proxy_url,proxy_username,proxy_password\nalice,secret123,,,\nbob,hunter2,http://proxy.io:8080,bob,proxypass`}
            rows={6}
            disabled={busy}
            className="font-mono text-xs"
          />
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-sm text-muted-foreground hover:bg-accent">
            <Upload className="h-6 w-6" />
            <span>
              {fileName ? `Selected: ${fileName}` : 'Click to choose a .csv, .txt, .xlsx, or .xls file'}
            </span>
            <input
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </label>
        )}

        {parsed.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{validRows.length}</span> valid
              </span>
              {errorRows.length > 0 ? (
                <span>
                  <span className="font-medium text-destructive">{errorRows.length}</span> invalid
                </span>
              ) : null}
            </div>
            <div className="max-h-40 overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">#</th>
                    <th className="px-2 py-1 text-left font-medium">Username</th>
                    <th className="px-2 py-1 text-left font-medium">Proxy</th>
                    <th className="px-2 py-1 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 50).map((r) => (
                    <tr key={r.rowNumber} className="border-t border-border even:bg-muted/30 last:border-b">
                      <td className="px-2 py-1 text-muted-foreground">{r.rowNumber}</td>
                      <td className="px-2 py-1 font-mono">{r.username || '—'}</td>
                      <td className="px-2 py-1 font-mono text-muted-foreground">
                        {r.proxyUrl ?? '—'}
                      </td>
                      <td className="px-2 py-1">
                        {r.error ? (
                          <span className="text-destructive">{r.error}</span>
                        ) : (
                          <span className="text-emerald-600">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.length > 50 ? (
                <div className="px-2 py-1 text-[11px] text-muted-foreground">
                  …and {parsed.length - 50} more
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  );
}

export function InstagramAccounts() {
  const { accounts, loading } = useAccounts();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [proxyTarget, setProxyTarget] = useState<AccountPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountPublic | null>(null);
  const [showLoginMethod, setShowLoginMethod] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((account) => {
      if (statusFilter !== 'all' && account.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        account.username,
        account.displayName ?? '',
        account.proxyUrl ?? '',
        account.proxyUsername ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [accounts, query, statusFilter]);

  async function handleStartManualLogin() {
    setAdding(true);
    setAddError(null);
    setShowLoginMethod(false);
    try {
      await b2dm.accounts.startLogin();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not start login');
    } finally {
      setAdding(false);
    }
  }

  async function handleStartAutoLogin(username: string, password: string) {
    setAdding(true);
    setAddError(null);
    setShowLoginMethod(false);
    try {
      await b2dm.accounts.startAutoLogin(username, password);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not start login');
    } finally {
      setAdding(false);
    }
  }

  async function handleStartBulk(rows: BulkRow[]) {
    setAdding(true);
    setAddError(null);
    try {
      await b2dm.accounts.startBulkAutoLogin(rows);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not start bulk login');
      throw err;
    } finally {
      setAdding(false);
    }
  }

  function openLoginMethod() {
    setShowLoginMethod(true);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="h-full">
        <EmptyState
          icon={<Instagram className="h-10 w-10" />}
          title="No Instagram accounts yet"
          description="Link an Instagram account to start sending DMs or scraping usernames."
          action={
            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={openLoginMethod} disabled={adding}>
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {adding ? 'Working…' : 'Link Instagram account'}
                </Button>
                <Button variant="outline" onClick={() => setShowBulk(true)} disabled={adding}>
                  <Upload className="h-4 w-4" />
                  Bulk import
                </Button>
              </div>
              {addError ? <p className="text-xs text-destructive">{addError}</p> : null}
            </div>
          }
        />
        {showLoginMethod ? (
          <LoginMethodDialog
            onClose={() => setShowLoginMethod(false)}
            onChooseManual={handleStartManualLogin}
            onChooseAuto={handleStartAutoLogin}
          />
        ) : null}
        {showBulk ? (
          <BulkLoginDialog onClose={() => setShowBulk(false)} onStart={handleStartBulk} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="bg-background">
        <div className="sticky top-0 z-20 flex items-stretch bg-background">
          <div className="relative min-w-0 flex-1 border-r border-border">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by username, name or proxy…"
              className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              className={cn(
                'h-9 border-r border-border px-3 text-xs font-medium transition-colors',
                statusFilter === option.value
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent/50'
              )}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowBulk(true)}
            disabled={adding}
            className="inline-flex h-9 items-center gap-1.5 border-r border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            <Upload className="h-3.5 w-3.5" />
            Bulk import
          </button>
          <button
            type="button"
            onClick={openLoginMethod}
            disabled={adding}
            className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {adding ? 'Working…' : 'Add account'}
          </button>
        </div>

        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col />
            <col className="w-24" />
            <col className="w-[38%]" />
            <col className="w-28" />
            <col className="w-24" />
          </colgroup>
          <thead className="sticky top-9 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">Account</th>
              <th className="px-3 py-1.5 text-left">Status</th>
              <th className="px-3 py-1.5 text-left">Proxy</th>
              <th className="px-3 py-1.5 text-right">Updated</th>
              <th className="px-2 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.length === 0 ? (
              <tr className="border-t border-border last:border-b">
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No accounts match your filters.
                </td>
              </tr>
            ) : (
              filteredAccounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onDelete={() => setDeleteTarget(account)}
                  onConfigureProxy={() => setProxyTarget(account)}
                />
              ))
            )}
          </tbody>
        </table>

      {proxyTarget ? (
        <ProxyDialog account={proxyTarget} onClose={() => setProxyTarget(null)} />
      ) : null}
      {deleteTarget ? (
        <ConfirmDeleteDialog account={deleteTarget} onClose={() => setDeleteTarget(null)} />
      ) : null}
      {showLoginMethod ? (
        <LoginMethodDialog
          onClose={() => setShowLoginMethod(false)}
          onChooseManual={handleStartManualLogin}
          onChooseAuto={handleStartAutoLogin}
        />
      ) : null}
      {showBulk ? (
        <BulkLoginDialog onClose={() => setShowBulk(false)} onStart={handleStartBulk} />
      ) : null}
    </div>
  );
}
