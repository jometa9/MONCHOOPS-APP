import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inbox as InboxIcon, RefreshCw, Send, Sparkles, Pin, PinOff, MoreVertical, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/common/Spinner';
import { EmptyState } from '@/components/common/EmptyState';
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type {
  AccountPublic,
  InboxMessagePublic,
  InboxSyncStatePublic,
  InboxThreadPublic,
} from '@/types/domain';

function formatRelative(ts: number | null): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString();
}

export function Inbox() {
  const [accounts, setAccounts] = useState<AccountPublic[] | null>(null);
  const [syncStates, setSyncStates] = useState<InboxSyncStatePublic[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [threads, setThreads] = useState<InboxThreadPublic[] | null>(null);
  const [filterUnread, setFilterUnread] = useState(false);
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [query, setQuery] = useState('');
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [openThread, setOpenThread] = useState<{
    thread: InboxThreadPublic;
    messages: InboxMessagePublic[];
  } | null>(null);
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const reloadAccounts = useCallback(async () => {
    const list = await b2dm.accounts.list();
    setAccounts(list);
    if (!selectedAccountId && list.length > 0) {
      setSelectedAccountId(list[0]!.id);
    }
  }, [selectedAccountId]);

  const reloadSyncStates = useCallback(async () => {
    setSyncStates(await b2dm.inbox.listSyncStates());
  }, []);

  const reloadThreads = useCallback(async () => {
    const accountIds = selectedAccountId ? [selectedAccountId] : undefined;
    const fromTs = filterFrom ? new Date(filterFrom).getTime() : null;
    const toTs = filterTo ? new Date(filterTo).getTime() : null;
    const list = await b2dm.inbox.listThreads({
      accountIds,
      from: fromTs,
      to: toTs,
      unreadOnly: filterUnread,
      query: query || null,
      limit: 200,
    });
    setThreads(list);
  }, [selectedAccountId, filterFrom, filterTo, filterUnread, query]);

  const reloadOpenThread = useCallback(async () => {
    if (!openThreadId) {
      setOpenThread(null);
      return;
    }
    const r = await b2dm.inbox.getThread({ threadId: openThreadId, limit: 200 });
    setOpenThread(r);
    if (r?.thread.draft && !composer) {
      setComposer(r.thread.draft.body);
    }
  }, [openThreadId, composer]);

  useEffect(() => {
    void reloadAccounts();
    void reloadSyncStates();
    const off1 = b2dm.accounts.onChange(() => void reloadAccounts());
    const off2 = b2dm.inbox.onChange(() => {
      void reloadSyncStates();
      void reloadThreads();
      void reloadOpenThread();
    });
    return () => {
      off1();
      off2();
    };
  }, [reloadAccounts, reloadOpenThread, reloadSyncStates, reloadThreads]);

  useEffect(() => {
    void reloadThreads();
  }, [reloadThreads]);

  useEffect(() => {
    void reloadOpenThread();
  }, [reloadOpenThread]);

  // When user picks a different thread, clear composer and re-load draft.
  useEffect(() => {
    setComposer('');
  }, [openThreadId]);

  async function handleRefresh() {
    if (!selectedAccountId) return;
    setRefreshing(true);
    try {
      await b2dm.inbox.refreshAccount(selectedAccountId);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSend() {
    if (!openThread || !composer.trim() || sending) return;
    setSending(true);
    try {
      await b2dm.inbox.sendMessage({ threadId: openThread.thread.id, text: composer.trim() });
      setComposer('');
    } finally {
      setSending(false);
    }
  }

  async function handleSuggest() {
    if (!openThread || suggesting) return;
    setSuggesting(true);
    try {
      const out = await b2dm.inbox.suggestReply({ threadId: openThread.thread.id });
      if (out?.body) setComposer(out.body);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  }

  async function toggleActiveMonitoring() {
    if (!selectedAccountId) return;
    const cur = syncStates.find((s) => s.accountId === selectedAccountId);
    await b2dm.inbox.setActiveMonitoring({
      accountId: selectedAccountId,
      enabled: !(cur?.activeMonitoring ?? false),
    });
  }

  async function togglePin() {
    if (!openThread) return;
    await b2dm.inbox.setThreadFlags({
      threadId: openThread.thread.id,
      flags: { isPinned: !openThread.thread.isPinned },
    });
  }

  async function toggleAi() {
    if (!openThread) return;
    await b2dm.inbox.setThreadFlags({
      threadId: openThread.thread.id,
      flags: { aiResponderEnabled: !openThread.thread.aiResponderEnabled },
    });
  }

  if (accounts === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon className="h-10 w-10" />}
        title="Connect an Instagram account first"
        description="Add an account on the Accounts screen to start syncing its DMs."
      />
    );
  }

  const selectedSync = selectedAccountId
    ? syncStates.find((s) => s.accountId === selectedAccountId) ?? null
    : null;

  return (
    <div className="grid h-full grid-cols-[220px_360px_1fr] divide-x divide-border">
      {/* Left rail — accounts */}
      <div className="overflow-y-auto">
        <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Accounts
        </div>
        {accounts.map((acc) => {
          const sync = syncStates.find((s) => s.accountId === acc.id);
          const isSel = acc.id === selectedAccountId;
          return (
            <button
              key={acc.id}
              onClick={() => setSelectedAccountId(acc.id)}
              className={cn(
                'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors',
                isSel ? 'bg-muted/40' : 'hover:bg-muted/20'
              )}
            >
              {acc.profilePicUrl ? (
                <img src={acc.profilePicUrl} alt="" className="h-7 w-7 rounded-full" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">@{acc.username}</div>
                <div className="text-[10px] text-muted-foreground">
                  {sync?.activeMonitoring ? 'Active' : 'Idle'}
                  {sync?.lastPollFinishedAt
                    ? ` · ${formatRelative(sync.lastPollFinishedAt)} ago`
                    : ''}
                </div>
              </div>
            </button>
          );
        })}
        {selectedAccountId ? (
          <div className="space-y-1 p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-center"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              Refresh now
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-center"
              onClick={() => void toggleActiveMonitoring()}
            >
              {selectedSync?.activeMonitoring ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" />
                  Stop active monitoring
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  Active monitoring
                </>
              )}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Middle pane — thread list with filters */}
      <div className="flex flex-col overflow-hidden">
        <div className="space-y-2 border-b border-border p-3">
          <Input
            placeholder="Search peer or preview…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              placeholder="From"
            />
            <Input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              placeholder="To"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={filterUnread}
              onChange={(e) => setFilterUnread(e.target.checked)}
            />
            Unread only
          </label>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads === null ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              <Spinner className="mx-auto h-4 w-4" />
            </div>
          ) : threads.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No conversations yet for this account.
            </div>
          ) : (
            threads.map((t) => {
              const isOpen = t.id === openThreadId;
              return (
                <button
                  key={t.id}
                  onClick={() => setOpenThreadId(t.id)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left text-sm transition-colors',
                    isOpen ? 'bg-muted/40' : 'hover:bg-muted/20'
                  )}
                >
                  {t.peerPicUrl ? (
                    <img src={t.peerPicUrl} alt="" className="h-9 w-9 rounded-full" />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {t.isPinned ? <Pin className="h-3 w-3 text-primary" /> : null}
                      <div className="truncate font-medium">@{t.peerUsername}</div>
                      {t.unreadCount > 0 ? (
                        <span className="ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                          {t.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.lastMessageFromMe ? <em>You: </em> : null}
                      {t.lastMessagePreview ?? <em>No messages</em>}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{formatRelative(t.lastMessageAt)}</span>
                      {t.aiResponderEnabled ? (
                        <span className="inline-flex items-center gap-0.5 text-primary">
                          <Sparkles className="h-2.5 w-2.5" /> AI
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right pane — conversation + composer */}
      <div className="flex flex-col overflow-hidden">
        {!openThread ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {openThread.thread.peerPicUrl ? (
                  <img
                    src={openThread.thread.peerPicUrl}
                    alt=""
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    @{openThread.thread.peerUsername}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    via @{openThread.thread.accountUsername}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void togglePin()}
                  title={openThread.thread.isPinned ? 'Unpin' : 'Pin'}
                >
                  {openThread.thread.isPinned ? (
                    <PinOff className="h-3.5 w-3.5" />
                  ) : (
                    <Pin className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant={openThread.thread.aiResponderEnabled ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => void toggleAi()}
                  title="Toggle AI responder for this thread"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void b2dm.inbox.fetchThread({
                      threadId: openThread.thread.id,
                      maxMessages: 500,
                    })
                  }
                  title="Load more history"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-muted/10 p-4">
              {openThread.messages.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  No messages in this thread yet.
                </div>
              ) : (
                openThread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      'flex',
                      m.direction === 'out' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                        m.direction === 'out'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background border border-border'
                      )}
                    >
                      {m.body ? (
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      ) : (
                        <div className="italic opacity-70">[{m.mediaKind ?? 'attachment'}]</div>
                      )}
                      <div
                        className={cn(
                          'mt-1 text-[10px]',
                          m.direction === 'out'
                            ? 'text-primary-foreground/70'
                            : 'text-muted-foreground'
                        )}
                      >
                        {formatDateTime(m.sentAt)}
                        {m.source === 'ai_responder' ? ' · AI' : ''}
                        {m.source === 'followup' ? ' · Follow-up' : ''}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-border bg-background p-3">
              {openThread.thread.draft ? (
                <div className="mb-2 flex items-center gap-1 text-[11px] text-primary">
                  <Sparkles className="h-3 w-3" /> Draft suggested by AI
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <textarea
                  ref={composerRef}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Type a reply…"
                  className="min-h-[60px] flex-1 resize-y rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
                  rows={3}
                />
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSuggest()}
                    disabled={suggesting}
                  >
                    {suggesting ? <Spinner className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                    AI Suggest
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSend()}
                    disabled={sending || composer.trim().length === 0}
                  >
                    {sending ? <Spinner className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
