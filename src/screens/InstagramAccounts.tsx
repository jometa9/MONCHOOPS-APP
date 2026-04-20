import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, AtSign, Eye, EyeOff, FileUp, Flame, Globe, Instagram, KeyRound, Loader2, MousePointerClick, Plus, RefreshCw, Search, Trash2, Upload, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { useAccounts } from '@/context/AccountsContext';
import { b2dm } from '@/lib/b2dm';
import type { AccountPublic } from '@/types/domain';

type StatusFilter = 'all' | AccountPublic['status'] | 'warmed';

function StatusBadge({ status }: { status: AccountPublic['status'] }) {
  if (status === 'busy') return <Badge variant="warning">Running</Badge>;
  if (status === 'error') return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="success">Idle</Badge>;
}

function WarmedBadge() {
  return (
    <Badge variant="default" title="Account is fully warmed up">
      <Flame className="h-2.5 w-2.5" />
      Warmed
    </Badge>
  );
}

function AccountRow({
  account,
  onDelete,
  onConfigureProxy,
  onRetry,
}: {
  account: AccountPublic;
  onDelete: () => void;
  onConfigureProxy: () => void;
  onRetry: () => void;
}) {
  return (
    <tr className="border-t border-border bg-background even:bg-muted last:border-b hover:bg-accent">
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
            <div className="text-sm font-medium leading-tight">@{account.username}</div>
            {account.displayName ? (
              <div className="text-[11px] leading-tight text-muted-foreground">
                {account.displayName}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={account.status} />
          {account.isWarmed ? <WarmedBadge /> : null}
        </div>
      </td>
      <td className="px-3 py-1.5">
        {account.proxyUrl ? (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs">
              <Globe className="h-3 w-3 flex-none text-muted-foreground" />
              <span className="font-mono">{account.proxyUrl}</span>
            </div>
            {account.proxyUsername ? (
              <div className="pl-[18px] text-[11px] text-muted-foreground">
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
          {account.status === 'error' ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              title="Retry login"
              aria-label="Retry login"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onConfigureProxy}
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            title="Configure proxy"
            aria-label="Configure proxy"
          >
            <Globe className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={account.status === 'busy'}
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
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

function RetryLoginDialog({
  account,
  onClose,
}: {
  account: AccountPublic;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasStored = account.hasStoredPassword;

  async function submit(useStored: boolean) {
    setBusy(true);
    setError(null);
    try {
      await b2dm.accounts.retryLogin(account.id, useStored ? null : password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start retry');
    } finally {
      setBusy(false);
    }
  }

  const canRetryStored = hasStored && !busy;
  const canSubmitTyped = password.trim().length > 0 && !busy;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Retry login for @${account.username}`}
      description={
        hasStored
          ? 'Retry with the saved password, or enter a new one if you changed it.'
          : 'Enter the password to retry signing in.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {hasStored ? (
            <Button variant="outline" onClick={() => submit(true)} disabled={!canRetryStored}>
              {busy ? <Spinner /> : null}
              Use saved password
            </Button>
          ) : null}
          <Button onClick={() => submit(false)} disabled={!canSubmitTyped}>
            {busy ? <Spinner /> : null}
            Sign in
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {account.lastError ? (
          <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 flex-none translate-y-0.5" />
            <span>{account.lastError}</span>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="retry-password">
            {hasStored ? 'New password (leave empty to use saved)' : 'Password'}
          </Label>
          <SquareIconInput
            id="retry-password"
            icon={KeyRound}
            type={showPassword ? 'text' : 'password'}
            placeholder={hasStored ? '•••••••• (saved)' : '••••••••'}
            value={password}
            onChange={setPassword}
            disabled={busy}
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                disabled={busy}
                className="flex w-10 flex-none items-center justify-center border-l border-border text-muted-foreground transition-colors hover:text-foreground"
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  );
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'idle', label: 'Idle' },
  { value: 'busy', label: 'Running' },
  { value: 'warmed', label: 'Warmed' },
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
  const [showPassword, setShowPassword] = useState(false);
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
          <SquareIconInput
            id="proxy-url"
            icon={Globe}
            placeholder="http://host:port or socks5://host:port"
            value={url}
            onChange={setUrl}
            disabled={saving}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="proxy-user">Username (optional)</Label>
          <SquareIconInput
            id="proxy-user"
            icon={AtSign}
            value={username}
            onChange={setUsername}
            disabled={saving}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="proxy-pass">Password (optional)</Label>
          <SquareIconInput
            id="proxy-pass"
            icon={KeyRound}
            type={showPassword ? 'text' : 'password'}
            placeholder={account.hasProxyPassword ? '•••••••• (stored)' : ''}
            value={password}
            onChange={setPassword}
            disabled={saving}
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                disabled={saving}
                className="flex w-10 flex-none items-center justify-center border-l border-border text-muted-foreground transition-colors hover:text-foreground"
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
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
          <Button onClick={confirm} disabled={busy}>
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

type AddMode = 'manual' | 'credentials' | 'bulk';

const ADD_MODES: { id: AddMode; label: string; icon: typeof MousePointerClick }[] = [
  { id: 'manual', label: 'Manual', icon: MousePointerClick },
  { id: 'credentials', label: 'Credentials', icon: KeyRound },
  { id: 'bulk', label: 'Bulk import', icon: Users },
];

function SquareIconInput({
  id,
  icon: Icon,
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled,
  trailing,
}: {
  id?: string;
  icon: typeof AtSign;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex h-10 items-stretch border border-border bg-background">
      <div className="flex w-10 flex-none items-center justify-center border-r border-border text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
      />
      {trailing}
    </div>
  );
}

interface ProxyInput {
  url: string;
  username: string | null;
  password: string | null;
}

function AddAccountDialog({
  onClose,
  onChooseManual,
  onChooseAuto,
  onStartBulk,
}: {
  onClose: () => void;
  onChooseManual: (proxy: ProxyInput | null) => Promise<void> | void;
  onChooseAuto: (
    username: string,
    password: string,
    proxy: ProxyInput | null
  ) => Promise<void> | void;
  onStartBulk: (rows: BulkRow[]) => Promise<void>;
}) {
  const [mode, setMode] = useState<AddMode>('manual');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyUser, setProxyUser] = useState('');
  const [proxyPass, setProxyPass] = useState('');
  const [showProxyPass, setShowProxyPass] = useState(false);

  function buildProxy(): ProxyInput | null {
    if (!proxyEnabled) return null;
    const url = proxyUrl.trim();
    if (!url) return null;
    return {
      url,
      username: proxyUser.trim() || null,
      password: proxyPass.length > 0 ? proxyPass : null,
    };
  }

  function validateProxy(): string | null {
    if (!proxyEnabled) return null;
    const url = proxyUrl.trim();
    if (!url) return 'Enter a proxy URL or disable the proxy toggle';
    if (!/^(https?|socks5):\/\/[^\s]+:\d+/.test(url)) {
      return 'Proxy URL must look like http://host:port or socks5://host:port';
    }
    return null;
  }

  const [bulkInput, setBulkInput] = useState<'paste' | 'file'>('paste');
  const [bulkText, setBulkText] = useState('');
  const [bulkParsed, setBulkParsed] = useState<ParsedRow[]>([]);
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);

  useEffect(() => {
    setBulkParsed(parseBulkText(bulkText));
  }, [bulkText]);

  const validRows = useMemo(() => bulkParsed.filter((r) => !r.error), [bulkParsed]);
  const errorRows = useMemo(() => bulkParsed.filter((r) => r.error), [bulkParsed]);

  async function handleFile(file: File) {
    setError(null);
    setBulkFileName(file.name);
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        setBulkText(await file.text());
        return;
      }
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]!]!;
        setBulkText(XLSX.utils.sheet_to_csv(sheet));
        return;
      }
      setError('Unsupported file type. Use .csv, .txt, .xlsx, or .xls');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read file');
    }
  }

  async function handleContinue() {
    setError(null);
    if (mode === 'manual') {
      const proxyErr = validateProxy();
      if (proxyErr) {
        setError(proxyErr);
        return;
      }
      setBusy(true);
      try {
        await onChooseManual(buildProxy());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start login');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === 'credentials') {
      if (!username.trim() || !password.trim()) {
        setError('Please enter both username and password');
        return;
      }
      const proxyErr = validateProxy();
      if (proxyErr) {
        setError(proxyErr);
        return;
      }
      setBusy(true);
      try {
        await onChooseAuto(username, password, buildProxy());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start login');
      } finally {
        setBusy(false);
      }
      return;
    }
    // bulk
    if (validRows.length === 0) {
      setError('No valid rows to import');
      return;
    }
    setBusy(true);
    try {
      await onStartBulk(
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

  const continueLabel =
    mode === 'manual'
      ? 'Continue'
      : mode === 'credentials'
      ? busy
        ? 'Signing in…'
        : 'Sign in'
      : busy
      ? 'Starting…'
      : `Import ${validRows.length} ${validRows.length === 1 ? 'account' : 'accounts'}`;

  const disabled =
    busy ||
    (mode === 'credentials' && (!username.trim() || !password.trim())) ||
    (mode === 'bulk' && validRows.length === 0);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Link Instagram Account"
      description="Choose how you want to sign in."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleContinue} disabled={disabled}>
            {busy ? <Spinner /> : null}
            {continueLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-stretch border border-border">
          {ADD_MODES.map((m, idx) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                disabled={busy}
                className={cn(
                  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
                  idx !== ADD_MODES.length - 1 && 'border-r border-border',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>

        {mode === 'manual' ? (
          <div className="border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            A browser window will open so you can sign in to Instagram yourself. The session is
            then saved to this device.
          </div>
        ) : null}

        {mode === 'credentials' ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ig-username">Username or Email</Label>
              <SquareIconInput
                id="ig-username"
                icon={AtSign}
                value={username}
                onChange={setUsername}
                placeholder="your.username or your.email@example.com"
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ig-password">Password</Label>
              <SquareIconInput
                id="ig-password"
                icon={KeyRound}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                disabled={busy}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    disabled={busy}
                    className="flex w-10 flex-none items-center justify-center border-l border-border text-muted-foreground transition-colors hover:text-foreground"
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
              />
            </div>
          </div>
        ) : null}

        {mode !== 'bulk' ? (
          <div className="space-y-2 border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">Route login through a proxy</span>
              </div>
              <Switch
                checked={proxyEnabled}
                onCheckedChange={setProxyEnabled}
                disabled={busy}
              />
            </div>
            {proxyEnabled ? (
              <div className="space-y-2 pt-1">
                <SquareIconInput
                  icon={Globe}
                  placeholder="http://host:port or socks5://host:port"
                  value={proxyUrl}
                  onChange={setProxyUrl}
                  disabled={busy}
                />
                <div className="grid grid-cols-2 gap-2">
                  <SquareIconInput
                    icon={AtSign}
                    placeholder="Username (optional)"
                    value={proxyUser}
                    onChange={setProxyUser}
                    disabled={busy}
                  />
                  <SquareIconInput
                    icon={KeyRound}
                    type={showProxyPass ? 'text' : 'password'}
                    placeholder="Password (optional)"
                    value={proxyPass}
                    onChange={setProxyPass}
                    disabled={busy}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowProxyPass((s) => !s)}
                        disabled={busy}
                        className="flex w-10 flex-none items-center justify-center border-l border-border text-muted-foreground transition-colors hover:text-foreground"
                        title={showProxyPass ? 'Hide password' : 'Show password'}
                        aria-label={showProxyPass ? 'Hide password' : 'Show password'}
                      >
                        {showProxyPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    }
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  The proxy is used for the login attempt and saved to the account for all future
                  sessions.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === 'bulk' ? (
          <div className="space-y-3">
            <div className="flex items-stretch border border-border">
              <button
                type="button"
                onClick={() => setBulkInput('paste')}
                disabled={busy}
                className={cn(
                  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 border-r border-border px-3 text-xs font-medium transition-colors',
                  bulkInput === 'paste'
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <FileUp className="h-3.5 w-3.5" />
                Paste CSV
              </button>
              <button
                type="button"
                onClick={() => setBulkInput('file')}
                disabled={busy}
                className={cn(
                  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
                  bulkInput === 'file'
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <Upload className="h-3.5 w-3.5" />
                Upload file
              </button>
            </div>

            <div className="border border-border bg-muted/30 p-3 text-xs">
              <div className="mb-1 font-medium">Expected columns (header optional):</div>
              <code className="block font-mono text-[11px] text-muted-foreground">{BULK_TEMPLATE}</code>
              <div className="mt-1 text-muted-foreground">
                Proxy fields are optional. Proxy URL must be <code>http://host:port</code> or{' '}
                <code>socks5://host:port</code>.
              </div>
            </div>

            {bulkInput === 'paste' ? (
              <Textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`username,password,proxy_url,proxy_username,proxy_password\nalice,secret123,,,\nbob,hunter2,http://proxy.io:8080,bob,proxypass`}
                rows={6}
                disabled={busy}
                className="font-mono text-xs"
              />
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed border-border p-6 text-sm text-muted-foreground hover:bg-accent">
                <Upload className="h-6 w-6" />
                <span>
                  {bulkFileName
                    ? `Selected: ${bulkFileName}`
                    : 'Click to choose a .csv, .txt, .xlsx, or .xls file'}
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

            {bulkParsed.length > 0 ? (
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
                <div className="max-h-40 overflow-auto border border-border">
                  <table className="w-full whitespace-nowrap text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">#</th>
                        <th className="px-2 py-1 text-left font-medium">Username</th>
                        <th className="px-2 py-1 text-left font-medium">Proxy</th>
                        <th className="px-2 py-1 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkParsed.slice(0, 50).map((r) => (
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
                  {bulkParsed.length > 50 ? (
                    <div className="px-2 py-1 text-[11px] text-muted-foreground">
                      …and {bulkParsed.length - 50} more
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

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

export function InstagramAccounts() {
  const { accounts, loading } = useAccounts();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [proxyTarget, setProxyTarget] = useState<AccountPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountPublic | null>(null);
  const [retryTarget, setRetryTarget] = useState<AccountPublic | null>(null);
  const [showLoginMethod, setShowLoginMethod] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((account) => {
      if (statusFilter === 'warmed') {
        if (!account.isWarmed) return false;
      } else if (statusFilter !== 'all' && account.status !== statusFilter) {
        return false;
      }
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

  async function handleStartManualLogin(proxy: ProxyInput | null) {
    setAdding(true);
    setAddError(null);
    setShowLoginMethod(false);
    try {
      await b2dm.accounts.startLogin(proxy ?? undefined);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not start login');
    } finally {
      setAdding(false);
    }
  }

  async function handleStartAutoLogin(
    username: string,
    password: string,
    proxy: ProxyInput | null
  ) {
    setAdding(true);
    setAddError(null);
    setShowLoginMethod(false);
    try {
      await b2dm.accounts.startAutoLogin(username, password, proxy ?? undefined);
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
      <>
        <EmptyState
          icon={<Instagram className="h-10 w-10" />}
          title="No Instagram accounts yet"
          description="Link an Instagram account to start sending DMs or scraping usernames."
          action={
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={openLoginMethod}
                disabled={adding}
                className="inline-flex h-9 items-center gap-1.5 border border-border bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {adding ? 'Working…' : 'Add account'}
              </button>
              {addError ? <p className="text-xs text-destructive">{addError}</p> : null}
            </div>
          }
        />
        {showLoginMethod ? (
          <AddAccountDialog
            onClose={() => setShowLoginMethod(false)}
            onChooseManual={handleStartManualLogin}
            onChooseAuto={handleStartAutoLogin}
            onStartBulk={handleStartBulk}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
        <div className="flex items-stretch bg-background">
          <button
            type="button"
            onClick={openLoginMethod}
            disabled={adding}
            className="inline-flex h-9 items-center gap-1.5 border-r border-border bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {adding ? 'Working…' : 'Add account'}
          </button>
          <div className="relative min-w-0 flex-1 border-r border-border bg-background">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by username, name or proxy…"
              className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {STATUS_FILTERS.map((option, idx) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              className={cn(
                'h-9 px-3 text-xs font-medium transition-colors',
                idx !== STATUS_FILTERS.length - 1 && 'border-r border-border',
                statusFilter === option.value
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent/50'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {filteredAccounts.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <EmptyState
              icon={<Search className="h-10 w-10" />}
              title="No accounts match your filters"
              description="Adjust your search or status filter to find the account you're looking for."
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full whitespace-nowrap border-collapse text-left">
              <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left">Account</th>
                  <th className="px-3 py-1.5 text-left">Status</th>
                  <th className="px-3 py-1.5 text-left">Proxy</th>
                  <th className="px-3 py-1.5 text-right">Updated</th>
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    onDelete={() => setDeleteTarget(account)}
                    onConfigureProxy={() => setProxyTarget(account)}
                    onRetry={() => setRetryTarget(account)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

      {proxyTarget ? (
        <ProxyDialog account={proxyTarget} onClose={() => setProxyTarget(null)} />
      ) : null}
      {deleteTarget ? (
        <ConfirmDeleteDialog account={deleteTarget} onClose={() => setDeleteTarget(null)} />
      ) : null}
      {retryTarget ? (
        <RetryLoginDialog account={retryTarget} onClose={() => setRetryTarget(null)} />
      ) : null}
      {showLoginMethod ? (
        <AddAccountDialog
          onClose={() => setShowLoginMethod(false)}
          onChooseManual={handleStartManualLogin}
          onChooseAuto={handleStartAutoLogin}
          onStartBulk={handleStartBulk}
        />
      ) : null}
    </div>
  );
}
