import { useMemo, useState } from 'react';
import { Globe, Instagram, Loader2, MoreVertical, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <tr className="border-t border-border hover:bg-accent/40">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2.5">
          {account.profilePicUrl ? (
            <img
              src={account.profilePicUrl}
              alt={account.username}
              className="h-7 w-7 flex-none rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Instagram className="h-3.5 w-3.5" />
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
      <td className="px-3 py-2">
        <StatusBadge status={account.status} />
      </td>
      <td className="px-3 py-2">
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
      <td className="px-3 py-2 text-right text-[11px] text-muted-foreground">
        {new Date(account.updatedAt).toLocaleDateString()}
      </td>
      <td className="px-2 py-2 text-right">
        <div className="relative inline-block">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="More"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-md border border-border bg-background p-1 shadow-md">
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setMenuOpen(false);
                    onConfigureProxy();
                  }}
                >
                  <Globe className="h-4 w-4" />
                  Configure proxy
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  disabled={account.status === 'busy'}
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete account
                </button>
              </div>
            </>
          ) : null}
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

export function InstagramAccounts() {
  const { accounts, loading } = useAccounts();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [proxyTarget, setProxyTarget] = useState<AccountPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountPublic | null>(null);
  const [showLoginMethod, setShowLoginMethod] = useState(false);
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
              <Button onClick={openLoginMethod} disabled={adding}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {adding ? 'Signing in…' : 'Link Instagram account'}
              </Button>
              {addError ? <p className="text-xs text-destructive">{addError}</p> : null}
            </div>
          }
        />
        {showLoginMethod && (
          <LoginMethodDialog
            onClose={() => setShowLoginMethod(false)}
            onChooseManual={handleStartManualLogin}
            onChooseAuto={handleStartAutoLogin}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Instagram accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Link multiple accounts and run actions from any of them.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username, name or proxy…"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {STATUS_FILTERS.map((option, index) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              className={
                'h-9 px-3 text-xs font-medium transition-colors ' +
                (statusFilter === option.value
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent/50') +
                (index > 0 ? ' border-l border-border' : '')
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button onClick={openLoginMethod} disabled={adding} className="h-9">
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {adding ? 'Signing in…' : 'Add account'}
        </Button>
      </div>

      {addError ? <p className="mt-3 text-xs text-destructive">{addError}</p> : null}

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-background">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col />
            <col className="w-24" />
            <col className="w-[38%]" />
            <col className="w-28" />
            <col className="w-12" />
          </colgroup>
          <thead>
            <tr className="bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Proxy</th>
              <th className="px-3 py-2 text-right">Updated</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.length === 0 ? (
              <tr className="border-t border-border">
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
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {filteredAccounts.length} of {accounts.length}{' '}
        {accounts.length === 1 ? 'account' : 'accounts'}
      </p>

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
    </div>
  );
}
