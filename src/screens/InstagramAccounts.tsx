import { useState } from 'react';
import { Globe, Instagram, Loader2, MoreVertical, Plus, Trash2 } from 'lucide-react';
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

function StatusBadge({ status }: { status: AccountPublic['status'] }) {
  if (status === 'busy') return <Badge variant="warning">Running</Badge>;
  if (status === 'error') return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="success">Idle</Badge>;
}

function AccountCard({
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
    <div className="relative flex items-center gap-3 rounded-xl border border-border bg-background p-4 shadow-sm">
      {account.profilePicUrl ? (
        <img
          src={account.profilePicUrl}
          alt={account.username}
          className="h-12 w-12 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Instagram className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-medium">@{account.username}</div>
          <StatusBadge status={account.status} />
        </div>
        {account.displayName ? (
          <div className="truncate text-xs text-muted-foreground">{account.displayName}</div>
        ) : null}
        <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Globe className="h-3 w-3" />
          <span>{account.proxyUrl ? account.proxyUrl : 'Direct connection'}</span>
        </div>
      </div>
      <div className="relative">
        <Button variant="ghost" size="icon" onClick={() => setMenuOpen((o) => !o)} aria-label="More">
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
    </div>
  );
}

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

export function InstagramAccounts() {
  const { accounts, loading } = useAccounts();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [proxyTarget, setProxyTarget] = useState<AccountPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountPublic | null>(null);

  async function startLogin() {
    setAdding(true);
    setAddError(null);
    try {
      await b2dm.accounts.startLogin();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not start login');
    } finally {
      setAdding(false);
    }
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
          description="Link an Instagram account to start sending DMs or scraping usernames. A browser window will open so you can sign in."
          action={
            <div className="flex flex-col items-center gap-2">
              <Button onClick={startLogin} disabled={adding}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {adding ? 'Opening browser…' : 'Link Instagram account'}
              </Button>
              {addError ? <p className="text-xs text-destructive">{addError}</p> : null}
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Instagram accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Link multiple accounts and run actions from any of them.
          </p>
        </div>
        <Button onClick={startLogin} disabled={adding}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {adding ? 'Opening browser…' : 'Add account'}
        </Button>
      </div>

      {addError ? <p className="mt-3 text-xs text-destructive">{addError}</p> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {accounts.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            onDelete={() => setDeleteTarget(account)}
            onConfigureProxy={() => setProxyTarget(account)}
          />
        ))}
      </div>

      {proxyTarget ? (
        <ProxyDialog account={proxyTarget} onClose={() => setProxyTarget(null)} />
      ) : null}
      {deleteTarget ? (
        <ConfirmDeleteDialog account={deleteTarget} onClose={() => setDeleteTarget(null)} />
      ) : null}
    </div>
  );
}
