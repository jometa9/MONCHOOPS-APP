import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Compass,
  Flame,
  Hash,
  Heart,
  History as HistoryIcon,
  Instagram,
  MapPin,
  Play,
  Rss,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/common/DatePicker';
import { EmptyState, EmptyStateLinkButton } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { TimePicker } from '@/components/common/TimePicker';
import { useAccounts } from '@/context/AccountsContext';
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type {
  AccountPublic,
  WarmupAction,
  WarmupResultPublic,
  WarmupSchedulePublic,
} from '@/types/domain';

// User-facing action groups. The "like" / "follow" groups are fanned out
// server-side into one or two concrete WarmupActions (hashtag_* and/or
// location_*) depending on which targets the user filled in.
type ActionGroupId = 'view_feed' | 'view_explore' | 'like' | 'follow' | 'combo';

interface ActionConfig {
  id: ActionGroupId;
  label: string;
  description: string;
  icon: typeof Rss;
}

const ACTIONS: ActionConfig[] = [
  {
    id: 'view_feed',
    label: 'Browse feed',
    description: 'Scroll the home feed like a normal user.',
    icon: Rss,
  },
  {
    id: 'view_explore',
    label: 'Browse explore',
    description: 'Scroll the explore grid to pick up fresh impressions.',
    icon: Compass,
  },
  {
    id: 'like',
    label: 'Like posts',
    description: 'Like recent posts from a hashtag, a location, or both.',
    icon: Heart,
  },
  {
    id: 'follow',
    label: 'Follow authors',
    description: 'Follow authors of recent posts from a hashtag, a location, or both.',
    icon: UserPlus,
  },
  {
    id: 'combo',
    label: 'Full warmup',
    description: 'Feed → explore → like + follow on a hashtag. Most realistic.',
    icon: Flame,
  },
];

const TABS: { id: 'run' | 'schedules' | 'history'; label: string; icon: typeof Rss }[] = [
  { id: 'run', label: 'Run', icon: Play },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'history', label: 'History', icon: HistoryIcon },
];

function SelectionBox({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'inline-flex h-4 w-4 flex-none items-center justify-center border transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background hover:border-foreground'
      )}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  );
}

function WarmedBadge() {
  return (
    <Badge variant="default">
      <Flame className="h-2.5 w-2.5" />
      Warmed
    </Badge>
  );
}

function AccountStatusBadge({ account }: { account: AccountPublic }) {
  if (account.status === 'busy') return <Badge variant="warning">Running</Badge>;
  if (account.status === 'error') return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="success">Idle</Badge>;
}

function formatRelative(ms: number | null): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDateTime(ms);
}

function formatDateYmd(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseYmdToLocalMidnight(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return dt.getTime();
}

function formatSecondsOfDay(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseHmToSeconds(hm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 3600 + min * 60;
}

function describeAction(action: WarmupAction): string {
  switch (action.type) {
    case 'view_feed':
      return `Browse feed · ${action.durationSec}s`;
    case 'view_explore':
      return `Browse explore · ${action.durationSec}s`;
    case 'hashtag_like':
      return `Like ${action.count} posts · #${action.hashtag}`;
    case 'hashtag_follow':
      return `Follow ${action.count} authors · #${action.hashtag}`;
    case 'location_like':
      return `Like ${action.count} posts · 📍${shortLocation(action.location)}`;
    case 'location_follow':
      return `Follow ${action.count} authors · 📍${shortLocation(action.location)}`;
    case 'combo':
      return `Full warmup · #${action.hashtag}`;
  }
}

function shortLocation(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Location inputs can be full IG URLs or bare slugs like "212988663/buenos-aires-argentina".
  // Extract the human-readable slug tail when possible so schedules and history rows stay readable.
  const m = /\/locations\/[^/]+\/([^/?#]+)/.exec(trimmed);
  if (m) return m[1];
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 45)}…`;
}

/* =====================================================================
   Root component
   ===================================================================== */

export function Warmup() {
  const { accounts, usableAccounts, loading } = useAccounts();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('run');

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<Flame className="h-10 w-10" />}
        title="Add an Instagram account first"
        description="Warmup actions run against a signed-in account."
        action={
          <EmptyStateLinkButton to="/accounts" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
            Add accounts
          </EmptyStateLinkButton>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-stretch border-b border-border bg-background">
        {TABS.map((t, idx) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
                idx !== TABS.length - 1 && 'border-r border-border',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'run' ? <RunTab accounts={usableAccounts} /> : null}
      {tab === 'schedules' ? <SchedulesTab accounts={accounts} /> : null}
      {tab === 'history' ? <HistoryTab /> : null}
    </div>
  );
}

/* =====================================================================
   Run tab — pick accounts, kick off a one-shot action or open the
   scheduler modal.
   ===================================================================== */

function RunTab({ accounts }: { accounts: AccountPublic[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Per-row quick-run state: when the user clicks an action icon on a
  // specific row, we pin the target to that single account so the picker
  // + the action dialog both scope to it. Null means "use the current
  // multi-selection from the table".
  const [rowTarget, setRowTarget] = useState<string | null>(null);
  const [actionPickerOpen, setActionPickerOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionGroupId | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => {
      const hay = [a.username, a.displayName ?? '', a.proxyUrl ?? ''].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [accounts, query]);

  const visibleSelected = useMemo(() => {
    const visible = new Set(filteredAccounts.map((a) => a.id));
    return new Set(Array.from(selected).filter((id) => visible.has(id)));
  }, [filteredAccounts, selected]);

  const accountById = useMemo(() => {
    const map = new Map<string, AccountPublic>();
    for (const a of accounts) map.set(a.id, a);
    return map;
  }, [accounts]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    const ids = filteredAccounts.map((a) => a.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  // Resolve the target account ids at the moment a dialog runs. If a
  // row-level icon was used, target = [that account]; otherwise we fan
  // out over the current visible selection.
  function resolveTargets(): string[] {
    if (rowTarget) return [rowTarget];
    return Array.from(visibleSelected);
  }

  async function runAction(actions: WarmupAction[]) {
    const targets = resolveTargets();
    if (targets.length === 0) return;
    for (const accountId of targets) {
      for (const action of actions) {
        try {
          await b2dm.jobs.startWarmup({ accountId, action });
        } catch (err) {
          console.error('Could not start warmup for', accountId, err);
        }
      }
    }
    setActiveAction(null);
    // Only clear the selection when we were acting on the multi-select.
    // For per-row runs, leave the selection alone.
    if (!rowTarget) setSelected(new Set());
    setRowTarget(null);
  }

  function openRowPicker(accountId: string) {
    setRowTarget(accountId);
    setActionPickerOpen(true);
  }
  function openRowSchedule(accountId: string) {
    setRowTarget(accountId);
    setScheduleOpen(true);
  }
  function openBulkSchedule() {
    setRowTarget(null);
    setScheduleOpen(true);
  }

  function cancelDialogs() {
    setActionPickerOpen(false);
    setActiveAction(null);
    setScheduleOpen(false);
    setRowTarget(null);
  }

  const selectedCount = visibleSelected.size;
  const canRunBulk = selectedCount > 0;

  // Label surfaced in dialogs: either "N accounts" or "@username".
  const activeTargets = rowTarget ? [rowTarget] : Array.from(visibleSelected);
  const dialogTargetLabel = rowTarget
    ? `@${accountById.get(rowTarget)?.username ?? rowTarget.slice(0, 8)}`
    : `${activeTargets.length} account${activeTargets.length === 1 ? '' : 's'}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-stretch bg-background">
        <div className="relative min-w-0 flex-1 border-r border-border bg-background">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts by username, name or proxy…"
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {(() => {
        // Split the action bar responsively: below lg, the first four
        // "atomic" actions sit on row 1 and the heavier Full warmup +
        // Schedule shortcut drop to row 2 so the labels stay legible on
        // narrow windows. At lg+ everything fits on a single row.
        const basicActions = ACTIONS.filter((a) => a.id !== 'combo');
        const comboAction = ACTIONS.find((a) => a.id === 'combo')!;

        const actionBtn = (a: ActionConfig) => {
          const Icon = a.icon;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setRowTarget(null);
                setActiveAction(a.id);
              }}
              disabled={!canRunBulk}
              className={cn(
                'inline-flex h-9 flex-1 items-center justify-center gap-1.5 border-r border-border px-3 text-xs font-medium transition-colors',
                canRunBulk
                  ? 'bg-background text-foreground hover:bg-accent'
                  : 'bg-background text-muted-foreground cursor-not-allowed opacity-60'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {a.label}
            </button>
          );
        };

        const scheduleBtn = (key: string) => (
          <button
            key={key}
            type="button"
            onClick={openBulkSchedule}
            disabled={!canRunBulk}
            className={cn(
              'inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
              canRunBulk
                ? 'bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground'
                : 'bg-background text-muted-foreground cursor-not-allowed opacity-60'
            )}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Schedule
          </button>
        );

        return (
          <>
            <div className="flex items-stretch border-t border-border bg-background">
              {basicActions.map(actionBtn)}
              {/* lg+ keeps Full warmup + Schedule inline; display:contents
                  strips this wrapper at lg+ so children participate in
                  the parent's flex row directly. */}
              <div className="hidden lg:contents">
                {actionBtn(comboAction)}
                {scheduleBtn('schedule-inline')}
              </div>
            </div>
            <div className="flex items-stretch border-t border-border bg-background lg:hidden">
              {actionBtn(comboAction)}
              {scheduleBtn('schedule-stacked')}
            </div>
          </>
        );
      })()}

      {filteredAccounts.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title="No accounts match your search"
            description="Clear the search to see every linked account again."
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap border-collapse text-left">
            <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-1.5 text-left">
                  <SelectionBox
                    checked={
                      filteredAccounts.length > 0 &&
                      filteredAccounts.every((a) => selected.has(a.id))
                    }
                    onToggle={toggleAllVisible}
                    ariaLabel="Select all visible accounts"
                  />
                </th>
                <th className="px-3 py-1.5 text-left">Account</th>
                <th className="px-3 py-1.5 text-left">Status</th>
                <th className="px-3 py-1.5 text-left">Last warmup</th>
                <th className="px-3 py-1.5 text-right">Active days</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((account) => (
                <WarmupAccountRow
                  key={account.id}
                  account={account}
                  selected={selected.has(account.id)}
                  onToggle={() => toggleOne(account.id)}
                  onQuickRun={() => openRowPicker(account.id)}
                  onQuickSchedule={() => openRowSchedule(account.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span>
          {selectedCount > 0 ? (
            <>
              <span className="font-medium text-foreground">{selectedCount}</span> selected
            </>
          ) : (
            'Pick one or more accounts, then choose an action or schedule'
          )}
        </span>
        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        ) : null}
      </div>

      {actionPickerOpen ? (
        <ActionPickerDialog
          targetLabel={dialogTargetLabel}
          onPick={(id) => {
            setActionPickerOpen(false);
            setActiveAction(id);
          }}
          onClose={() => {
            setActionPickerOpen(false);
            setRowTarget(null);
          }}
        />
      ) : null}

      {activeAction ? (
        <ActionDialog
          actionId={activeAction}
          targetLabel={dialogTargetLabel}
          onClose={cancelDialogs}
          onRun={runAction}
        />
      ) : null}

      {scheduleOpen ? (
        <ScheduleDialog
          accountIds={activeTargets}
          targetLabel={dialogTargetLabel}
          onClose={cancelDialogs}
          onCreated={() => {
            setScheduleOpen(false);
            // Bulk scheduling clears the selection; per-row scheduling
            // leaves it so the user can keep working.
            if (!rowTarget) setSelected(new Set());
            setRowTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function WarmupAccountRow({
  account,
  selected,
  onToggle,
  onQuickRun,
  onQuickSchedule,
}: {
  account: AccountPublic;
  selected: boolean;
  onToggle: () => void;
  onQuickRun: () => void;
  onQuickSchedule: () => void;
}) {
  return (
    <tr
      onClick={onToggle}
      className={cn(
        'cursor-pointer border-t border-border bg-background even:bg-muted last:border-b hover:bg-accent',
        selected && 'bg-primary/5 hover:bg-primary/10'
      )}
    >
      <td className="w-8 px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
        <SelectionBox
          checked={selected}
          onToggle={onToggle}
          ariaLabel={`Select @${account.username}`}
        />
      </td>
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
          </div>
        </div>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <AccountStatusBadge account={account} />
          {account.isWarmed ? <WarmedBadge /> : null}
        </div>
      </td>
      <td className="px-3 py-1.5 text-[11px] text-muted-foreground">
        {formatRelative(account.lastWarmupAt)}
      </td>
      <td className="px-3 py-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
        {account.warmupActiveDays}
      </td>
      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={onQuickRun}
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Queue a warmup for @${account.username}`}
          >
            <Play className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onQuickSchedule}
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Schedule warmups for @${account.username}`}
          >
            <CalendarClock className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/* =====================================================================
   Schedules tab — list + per-row delete.
   ===================================================================== */

function SchedulesTab({ accounts }: { accounts: AccountPublic[] }) {
  const [rows, setRows] = useState<WarmupSchedulePublic[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await b2dm.warmups.listSchedules();
      if (!cancelled) setRows(list);
    }
    void load();
    const off = b2dm.warmups.onSchedulesChange(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  async function remove(id: string) {
    try {
      await b2dm.warmups.deleteSchedule(id);
    } catch (err) {
      console.error('Could not delete schedule:', err);
    }
  }

  if (rows === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock className="h-10 w-10" />}
        title="No schedules yet"
        description="Select one or more accounts in the Run tab and click Schedule to set up a recurring warmup."
      />
    );
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full whitespace-nowrap border-collapse text-left">
        <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-left">Account</th>
            <th className="px-3 py-1.5 text-left">Range</th>
            <th className="px-3 py-1.5 text-left">Time</th>
            <th className="px-3 py-1.5 text-left">Actions</th>
            <th className="px-3 py-1.5 text-left">Last fired</th>
            <th className="w-8 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const account = accountById.get(row.accountId);
            return (
              <tr
                key={row.id}
                className="border-t border-border bg-background even:bg-muted last:border-b hover:bg-accent"
              >
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Flame className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sm font-medium">
                      @{account?.username ?? row.accountId.slice(0, 8)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {formatDateYmd(row.startDate)} → {formatDateYmd(row.endDate)}
                </td>
                <td className="px-3 py-1.5 text-xs tabular-nums">
                  {formatSecondsOfDay(row.timeOfDaySec)}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-col gap-0.5 text-[11px]">
                    {row.actions.map((a, i) => (
                      <span key={i} className="text-muted-foreground">
                        {describeAction(a)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-[11px] text-muted-foreground">
                  {formatRelative(row.lastFiredAt)}
                </td>
                <td className="w-8 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => void remove(row.id)}
                    className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-destructive"
                    aria-label="Delete schedule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* =====================================================================
   History tab — warmup_results rows.
   ===================================================================== */

function HistoryTab() {
  const [rows, setRows] = useState<WarmupResultPublic[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await b2dm.warmups.list();
      if (!cancelled) setRows(list);
    }
    void load();
    const off = b2dm.jobs.onDone(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (rows === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<HistoryIcon className="h-10 w-10" />}
        title="No warmups yet"
        description="Once a warmup completes, it shows up here with its counters."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full whitespace-nowrap border-collapse text-left">
        <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-left">Account</th>
            <th className="px-3 py-1.5 text-left">Action</th>
            <th className="px-3 py-1.5 text-right">Visited</th>
            <th className="px-3 py-1.5 text-right">Liked</th>
            <th className="px-3 py-1.5 text-right">Followed</th>
            <th className="px-3 py-1.5 text-right">Skipped</th>
            <th className="px-3 py-1.5 text-left">Completed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.jobId}
              className="border-t border-border bg-background even:bg-muted last:border-b hover:bg-accent"
            >
              <td className="px-3 py-1.5 text-sm">
                @{row.accountUsername ?? row.accountId?.slice(0, 8) ?? '—'}
              </td>
              <td className="px-3 py-1.5 text-xs">{describeAction(row.action)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{row.visited || '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{row.liked || '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{row.followed || '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                {row.skipped || '—'}
              </td>
              <td className="px-3 py-1.5 text-[11px] text-muted-foreground">
                {formatDateTime(row.completedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =====================================================================
   Action picker — small dialog shown from per-row icons to pick which
   one-shot action to run against that single account.
   ===================================================================== */

function ActionPickerDialog({
  targetLabel,
  onPick,
  onClose,
}: {
  targetLabel: string;
  onPick: (id: ActionGroupId) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Pick a warmup action"
      description={`Will run on ${targetLabel}.`}
      className="max-w-lg"
    >
      <div className="grid grid-cols-1 gap-2">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onPick(a.id)}
              className="flex items-start gap-3 border border-border bg-background p-3 text-left transition-colors hover:bg-accent"
            >
              <Icon className="mt-0.5 h-4 w-4 flex-none text-primary" />
              <div>
                <div className="text-sm font-medium">{a.label}</div>
                <div className="text-[11px] text-muted-foreground">{a.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

/* =====================================================================
   One-shot action dialogs
   ===================================================================== */

function ActionDialog({
  actionId,
  targetLabel,
  onClose,
  onRun,
}: {
  actionId: ActionGroupId;
  targetLabel: string;
  onClose: () => void;
  onRun: (actions: WarmupAction[]) => Promise<void>;
}) {
  switch (actionId) {
    case 'view_feed':
      return (
        <DurationDialog
          title="Browse feed"
          description="Scroll the home feed with human-like pauses. Safe, low-impact warmup."
          icon={Rss}
          targetLabel={targetLabel}
          defaultSec={180}
          onClose={onClose}
          onRun={(durationSec) => onRun([{ type: 'view_feed', durationSec }])}
        />
      );
    case 'view_explore':
      return (
        <DurationDialog
          title="Browse explore"
          description="Scroll the explore grid, picking up new impressions for the account."
          icon={Compass}
          targetLabel={targetLabel}
          defaultSec={180}
          onClose={onClose}
          onRun={(durationSec) => onRun([{ type: 'view_explore', durationSec }])}
        />
      );
    case 'like':
      return (
        <HashLocDialog
          mode="like"
          targetLabel={targetLabel}
          onClose={onClose}
          onRun={onRun}
        />
      );
    case 'follow':
      return (
        <HashLocDialog
          mode="follow"
          targetLabel={targetLabel}
          onClose={onClose}
          onRun={onRun}
        />
      );
    case 'combo':
      return (
        <ComboDialog
          targetLabel={targetLabel}
          onClose={onClose}
          onRun={(action) => onRun([action])}
        />
      );
  }
}

function DialogHeader({
  icon: Icon,
  targetLabel,
}: {
  icon: typeof Rss;
  targetLabel: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
      <Icon className="h-4 w-4 text-primary" />
      Will run on <span className="font-medium text-foreground">{targetLabel}</span>.
    </div>
  );
}

function DurationDialog({
  title,
  description,
  icon,
  targetLabel,
  defaultSec,
  onClose,
  onRun,
}: {
  title: string;
  description: string;
  icon: typeof Rss;
  targetLabel: string;
  defaultSec: number;
  onClose: () => void;
  onRun: (durationSec: number) => Promise<void>;
}) {
  const [durationSec, setDurationSec] = useState(defaultSec);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onRun(Math.max(30, Math.min(1800, durationSec)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start warmup');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <Play className="h-3.5 w-3.5" />}
            {busy ? 'Starting…' : 'Run warmup'}
          </Button>
        </>
      }
    >
      <DialogHeader icon={icon} targetLabel={targetLabel} />
      <div className="space-y-1">
        <Label htmlFor="warmup-duration">Duration (seconds)</Label>
        <Input
          id="warmup-duration"
          type="number"
          min={30}
          max={1800}
          value={durationSec}
          onChange={(e) => setDurationSec(Number(e.target.value) || 0)}
        />
        <p className="text-[11px] text-muted-foreground">
          Between 30s and 30min. Around 2–5 minutes is the typical warmup slot.
        </p>
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </Dialog>
  );
}

function HashLocDialog({
  mode,
  targetLabel,
  onClose,
  onRun,
}: {
  mode: 'like' | 'follow';
  targetLabel: string;
  onClose: () => void;
  onRun: (actions: WarmupAction[]) => Promise<void>;
}) {
  const isLike = mode === 'like';
  const icon = isLike ? Heart : UserPlus;
  const title = isLike ? 'Like posts' : 'Follow authors';
  const description = isLike
    ? 'Like recent posts from a hashtag, a location, or both. Fill whichever you want — empty ones are skipped.'
    : 'Follow authors of recent posts from a hashtag, a location, or both. Fill whichever you want — empty ones are skipped.';

  const [hashtag, setHashtag] = useState('');
  const [location, setLocation] = useState('');
  const [count, setCount] = useState(isLike ? 10 : 8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cleanTag = hashtag.trim().replace(/^#+/, '');
    const cleanLoc = location.trim();
    if (!cleanTag && !cleanLoc) {
      setError('Fill a hashtag, a location, or both');
      return;
    }
    const c = Math.max(1, Math.min(50, count));
    const actions: WarmupAction[] = [];
    if (cleanTag) {
      actions.push(
        isLike
          ? { type: 'hashtag_like', hashtag: cleanTag, count: c }
          : { type: 'hashtag_follow', hashtag: cleanTag, count: c }
      );
    }
    if (cleanLoc) {
      actions.push(
        isLike
          ? { type: 'location_like', location: cleanLoc, count: c }
          : { type: 'location_follow', location: cleanLoc, count: c }
      );
    }
    setBusy(true);
    setError(null);
    try {
      await onRun(actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start warmup');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <Play className="h-3.5 w-3.5" />}
            {busy ? 'Starting…' : 'Run warmup'}
          </Button>
        </>
      }
    >
      <DialogHeader icon={icon} targetLabel={targetLabel} />
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="warmup-hashtag">Hashtag</Label>
          <div className="flex h-10 items-stretch border border-border bg-background">
            <div className="flex w-10 flex-none items-center justify-center border-r border-border text-muted-foreground">
              <Hash className="h-4 w-4" />
            </div>
            <input
              id="warmup-hashtag"
              value={hashtag}
              onChange={(e) => setHashtag(e.target.value)}
              placeholder="e.g. fitness (optional)"
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="warmup-location">Location URL or slug</Label>
          <div className="flex h-10 items-stretch border border-border bg-background">
            <div className="flex w-10 flex-none items-center justify-center border-r border-border text-muted-foreground">
              <MapPin className="h-4 w-4" />
            </div>
            <input
              id="warmup-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="212988663/buenos-aires-argentina (optional)"
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Paste the part after <span className="font-mono">/explore/locations/</span>, or a full
            Instagram location URL.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="warmup-count">
            Number of {isLike ? 'posts' : 'authors'} per target
          </Label>
          <Input
            id="warmup-count"
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 0)}
          />
          <p className="text-[11px] text-muted-foreground">
            Between 1 and 50. If you fill both hashtag and location, this count runs twice (one
            per target). Keep it under 15 for fresh / low-trust accounts.
          </p>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </Dialog>
  );
}

function ComboDialog({
  targetLabel,
  onClose,
  onRun,
}: {
  targetLabel: string;
  onClose: () => void;
  onRun: (action: WarmupAction) => Promise<void>;
}) {
  const [feedSec, setFeedSec] = useState(120);
  const [exploreSec, setExploreSec] = useState(120);
  const [hashtag, setHashtag] = useState('');
  const [likeCount, setLikeCount] = useState(5);
  const [followCount, setFollowCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const clean = hashtag.trim().replace(/^#+/, '');
    if (!clean) {
      setError('Enter a hashtag for the like/follow phase');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRun({
        type: 'combo',
        feedSec: Math.max(0, Math.min(1800, feedSec)),
        exploreSec: Math.max(0, Math.min(1800, exploreSec)),
        hashtag: clean,
        likeCount: Math.max(0, Math.min(50, likeCount)),
        followCount: Math.max(0, Math.min(50, followCount)),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start warmup');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title="Full warmup"
      description="Sequences feed → explore → like + follow on a hashtag. Most natural pattern for a fresh account."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <Play className="h-3.5 w-3.5" />}
            {busy ? 'Starting…' : 'Run warmup'}
          </Button>
        </>
      }
    >
      <DialogHeader icon={Flame} targetLabel={targetLabel} />
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="combo-feed">Feed (seconds)</Label>
            <Input
              id="combo-feed"
              type="number"
              min={0}
              max={1800}
              value={feedSec}
              onChange={(e) => setFeedSec(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="combo-explore">Explore (seconds)</Label>
            <Input
              id="combo-explore"
              type="number"
              min={0}
              max={1800}
              value={exploreSec}
              onChange={(e) => setExploreSec(Number(e.target.value) || 0)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="combo-hashtag">Hashtag</Label>
          <div className="flex h-10 items-stretch border border-border bg-background">
            <div className="flex w-10 flex-none items-center justify-center border-r border-border text-muted-foreground">
              <Hash className="h-4 w-4" />
            </div>
            <input
              id="combo-hashtag"
              value={hashtag}
              onChange={(e) => setHashtag(e.target.value)}
              placeholder="e.g. fitness"
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="combo-like">Likes</Label>
            <Input
              id="combo-like"
              type="number"
              min={0}
              max={50}
              value={likeCount}
              onChange={(e) => setLikeCount(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="combo-follow">Follows</Label>
            <Input
              id="combo-follow"
              type="number"
              min={0}
              max={50}
              value={followCount}
              onChange={(e) => setFollowCount(Number(e.target.value) || 0)}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Set any of the four numbers to 0 to skip that phase. Likes + follows share the same
          hashtag but run as separate passes.
        </p>
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </Dialog>
  );
}

/* =====================================================================
   Schedule dialog — builds a WarmupSchedule with a "playlist" of
   up to four actions (feed, explore, hashtag_like, hashtag_follow).
   The playlist fires in that order every scheduled day.
   ===================================================================== */

interface ScheduleState {
  startDate: string;
  endDate: string;
  timeOfDay: string;
  feed: { enabled: boolean; durationSec: number };
  explore: { enabled: boolean; durationSec: number };
  // Unified "Like" and "Follow" groups: fill hashtag, location, or both.
  // buildActions() fans each filled target out into its own WarmupAction.
  like: { enabled: boolean; hashtag: string; location: string; count: number };
  follow: { enabled: boolean; hashtag: string; location: string; count: number };
}

function defaultScheduleState(): ScheduleState {
  const today = formatDateYmd(Date.now());
  const in30 = formatDateYmd(Date.now() + 30 * 86_400_000);
  return {
    startDate: today,
    endDate: in30,
    timeOfDay: '09:00',
    feed: { enabled: true, durationSec: 180 },
    explore: { enabled: true, durationSec: 180 },
    like: { enabled: false, hashtag: '', location: '', count: 8 },
    follow: { enabled: false, hashtag: '', location: '', count: 5 },
  };
}

function buildActions(state: ScheduleState): { actions: WarmupAction[]; error: string | null } {
  const actions: WarmupAction[] = [];
  if (state.feed.enabled) {
    actions.push({
      type: 'view_feed',
      durationSec: Math.max(30, Math.min(1800, state.feed.durationSec)),
    });
  }
  if (state.explore.enabled) {
    actions.push({
      type: 'view_explore',
      durationSec: Math.max(30, Math.min(1800, state.explore.durationSec)),
    });
  }
  if (state.like.enabled) {
    const tag = state.like.hashtag.trim().replace(/^#+/, '');
    const loc = state.like.location.trim();
    if (!tag && !loc) {
      return { actions: [], error: 'Set a hashtag, a location, or both for the "Like" action' };
    }
    const c = Math.max(1, Math.min(50, state.like.count));
    if (tag) actions.push({ type: 'hashtag_like', hashtag: tag, count: c });
    if (loc) actions.push({ type: 'location_like', location: loc, count: c });
  }
  if (state.follow.enabled) {
    const tag = state.follow.hashtag.trim().replace(/^#+/, '');
    const loc = state.follow.location.trim();
    if (!tag && !loc) {
      return { actions: [], error: 'Set a hashtag, a location, or both for the "Follow" action' };
    }
    const c = Math.max(1, Math.min(50, state.follow.count));
    if (tag) actions.push({ type: 'hashtag_follow', hashtag: tag, count: c });
    if (loc) actions.push({ type: 'location_follow', location: loc, count: c });
  }
  if (actions.length === 0) {
    return { actions: [], error: 'Enable at least one action' };
  }
  return { actions, error: null };
}

function ScheduleDialog({
  accountIds,
  targetLabel,
  onClose,
  onCreated,
}: {
  accountIds: string[];
  targetLabel: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [state, setState] = useState<ScheduleState>(defaultScheduleState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<ScheduleState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  async function submit() {
    const startMs = parseYmdToLocalMidnight(state.startDate);
    const endMs = parseYmdToLocalMidnight(state.endDate);
    const timeSec = parseHmToSeconds(state.timeOfDay);
    if (startMs == null || endMs == null) {
      setError('Start and end dates are required');
      return;
    }
    if (endMs < startMs) {
      setError('End date must be on or after the start date');
      return;
    }
    if (timeSec == null) {
      setError('Time of day must look like HH:MM');
      return;
    }
    const built = buildActions(state);
    if (built.error) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const accountId of accountIds) {
        await b2dm.warmups.createSchedule({
          accountId,
          startDate: startMs,
          endDate: endMs,
          timeOfDaySec: timeSec,
          actions: built.actions,
        });
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create schedule');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title="Schedule warmup"
      description="Run the selected actions every day at the chosen time, until the end date. Missed days (app closed) are skipped; the next tick after the app reopens catches up for today."
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <CalendarClock className="h-3.5 w-3.5" />}
            {busy ? 'Creating…' : `Schedule for ${targetLabel}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="sch-start">Start date</Label>
            <DatePicker
              id="sch-start"
              value={state.startDate}
              onChange={(v) => patch({ startDate: v })}
              max={state.endDate || undefined}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sch-end">End date</Label>
            <DatePicker
              id="sch-end"
              value={state.endDate}
              onChange={(v) => patch({ endDate: v })}
              min={state.startDate || undefined}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sch-time">Time (local)</Label>
            <TimePicker
              id="sch-time"
              value={state.timeOfDay}
              onChange={(v) => patch({ timeOfDay: v })}
            />
          </div>
        </div>

        <table className="w-full border-collapse border border-border text-left">
          <thead className="bg-muted text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-1.5" />
              <th className="px-2 py-1.5">Action</th>
              <th className="px-2 py-1.5">Target</th>
              <th className="w-24 px-2 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <ScheduleTableRow
              icon={Rss}
              title="Browse feed"
              enabled={state.feed.enabled}
              onToggle={(enabled) => patch({ feed: { ...state.feed, enabled } })}
              amount={state.feed.durationSec}
              amountUnit="sec"
              amountMin={30}
              amountMax={1800}
              onAmount={(durationSec) => patch({ feed: { ...state.feed, durationSec } })}
            />
            <ScheduleTableRow
              icon={Compass}
              title="Browse explore"
              enabled={state.explore.enabled}
              onToggle={(enabled) => patch({ explore: { ...state.explore, enabled } })}
              amount={state.explore.durationSec}
              amountUnit="sec"
              amountMin={30}
              amountMax={1800}
              onAmount={(durationSec) => patch({ explore: { ...state.explore, durationSec } })}
            />
            <ScheduleTableRow
              icon={Heart}
              title="Like posts"
              enabled={state.like.enabled}
              onToggle={(enabled) => patch({ like: { ...state.like, enabled } })}
              hashtagValue={state.like.hashtag}
              onHashtag={(hashtag) => patch({ like: { ...state.like, hashtag } })}
              locationValue={state.like.location}
              onLocation={(location) => patch({ like: { ...state.like, location } })}
              amount={state.like.count}
              amountUnit="posts"
              amountMin={1}
              amountMax={50}
              onAmount={(count) => patch({ like: { ...state.like, count } })}
            />
            <ScheduleTableRow
              icon={UserPlus}
              title="Follow authors"
              enabled={state.follow.enabled}
              onToggle={(enabled) => patch({ follow: { ...state.follow, enabled } })}
              hashtagValue={state.follow.hashtag}
              onHashtag={(hashtag) => patch({ follow: { ...state.follow, hashtag } })}
              locationValue={state.follow.location}
              onLocation={(location) => patch({ follow: { ...state.follow, location } })}
              amount={state.follow.count}
              amountUnit="users"
              amountMin={1}
              amountMax={50}
              onAmount={(count) => patch({ follow: { ...state.follow, count } })}
            />
          </tbody>
        </table>

        <p className="text-[11px] text-muted-foreground">
          Enabled rows run in order. Missed days (app closed at fire time) are skipped; if the
          app reopens later the same day, the run catches up.
        </p>
      </div>

      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
    </Dialog>
  );
}

function ScheduleTableRow({
  icon: Icon,
  title,
  enabled,
  onToggle,
  hashtagValue,
  onHashtag,
  locationValue,
  onLocation,
  amount,
  amountUnit,
  amountMin,
  amountMax,
  onAmount,
}: {
  icon: typeof Rss;
  title: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  hashtagValue?: string;
  onHashtag?: (v: string) => void;
  locationValue?: string;
  onLocation?: (v: string) => void;
  amount: number;
  amountUnit: string;
  amountMin: number;
  amountMax: number;
  onAmount: (v: number) => void;
}) {
  const hasHashtag = onHashtag !== undefined;
  const hasLocation = onLocation !== undefined;
  const hasAnyTarget = hasHashtag || hasLocation;
  return (
    <tr className="border-t border-border bg-background even:bg-muted/40">
      <td className="w-8 px-2 py-1.5 align-top">
        <div className="pt-0.5">
          <SelectionBox
            checked={enabled}
            onToggle={() => onToggle(!enabled)}
            ariaLabel={`Enable ${title}`}
          />
        </div>
      </td>
      <td className="px-2 py-1.5 align-top">
        <div
          className={cn(
            'flex items-center gap-2 pt-0.5 text-xs font-medium',
            !enabled && 'opacity-50'
          )}
        >
          <Icon className={cn('h-3.5 w-3.5', enabled ? 'text-primary' : 'text-muted-foreground')} />
          {title}
        </div>
      </td>
      <td className={cn('px-2 py-1.5 align-top', !enabled && 'opacity-50')}>
        {hasAnyTarget ? (
          <div className="flex flex-col gap-1">
            {hasHashtag ? (
              <div className="flex h-7 items-stretch border border-border bg-background">
                <div className="flex w-6 flex-none items-center justify-center border-r border-border text-muted-foreground">
                  <Hash className="h-3 w-3" />
                </div>
                <input
                  value={hashtagValue ?? ''}
                  onChange={(e) => onHashtag!(e.target.value)}
                  disabled={!enabled}
                  placeholder="fitness (optional)"
                  className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground disabled:opacity-50"
                />
              </div>
            ) : null}
            {hasLocation ? (
              <div className="flex h-7 items-stretch border border-border bg-background">
                <div className="flex w-6 flex-none items-center justify-center border-r border-border text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                </div>
                <input
                  value={locationValue ?? ''}
                  onChange={(e) => onLocation!(e.target.value)}
                  disabled={!enabled}
                  placeholder="212988663/buenos-aires (optional)"
                  className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground disabled:opacity-50"
                />
              </div>
            ) : null}
          </div>
        ) : (
          <span className="pt-0.5 text-[11px] text-muted-foreground">—</span>
        )}
      </td>
      <td className={cn('w-24 px-2 py-1.5 align-top', !enabled && 'opacity-50')}>
        <div className="flex h-7 items-stretch border border-border bg-background">
          <input
            type="number"
            min={amountMin}
            max={amountMax}
            value={amount}
            disabled={!enabled}
            onChange={(e) => onAmount(Number(e.target.value) || 0)}
            className="min-w-0 flex-1 bg-transparent px-2 text-xs tabular-nums outline-none disabled:opacity-50"
          />
          <div className="flex flex-none items-center border-l border-border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {amountUnit}
          </div>
        </div>
      </td>
    </tr>
  );
}
