import { useEffect, useState } from 'react';
import { Sparkles, RotateCcw, Save, Power, AlertTriangle } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';
import type {
  AccountAiSettings,
  AccountPublic,
  AiCostSummary,
  AiSettings,
  AnthropicModelInfo,
  ResponderMode,
} from '@/types/domain';
import { DEFAULT_PROMPT_MD } from './AutoResponder.defaults';

interface Defaults {
  historyDepth: number;
  mode: ResponderMode;
  killSwitch: boolean;
  excludeKeywords: string[];
  minInboundLen: number;
  maxAiStreak: number;
}

export function AutoResponder() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [models, setModels] = useState<AnthropicModelInfo[]>([]);
  const [prompt, setPrompt] = useState<string>('');
  const [loadedDefaultMd, setLoadedDefaultMd] = useState<string>(DEFAULT_PROMPT_MD);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [accountSettings, setAccountSettings] = useState<Record<string, AccountAiSettings>>({});
  const [cost, setCost] = useState<AiCostSummary | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedPromptAt, setSavedPromptAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [s, mds, p, d, accs, accSettings, c] = await Promise.all([
        b2dm.ai.getSettings(),
        b2dm.ai.listModels(),
        b2dm.ai.getPrompt(),
        b2dm.ai.getDefaults(),
        b2dm.accounts.list(),
        b2dm.ai.listAccountSettings(),
        b2dm.ai.getMonthCost(),
      ]);
      if (cancelled) return;
      setSettings(s);
      setModels(mds);
      setPrompt(p.md);
      setLoadedDefaultMd(p.defaultMd);
      setDefaults(d);
      setAccounts(accs);
      const map: Record<string, AccountAiSettings> = {};
      for (const a of accSettings) map[a.accountId] = a;
      setAccountSettings(map);
      setCost(c);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadCost() {
    setCost(await b2dm.ai.getMonthCost());
  }

  async function savePrompt() {
    setSavingPrompt(true);
    try {
      await b2dm.ai.setPrompt(prompt);
      setSavedPromptAt(Date.now());
    } finally {
      setSavingPrompt(false);
    }
  }

  async function setDefaultsField<K extends keyof Defaults>(key: K, value: Defaults[K]) {
    if (!defaults) return;
    const next = { ...defaults, [key]: value };
    setDefaults(next);
    await b2dm.ai.setDefaults({ [key]: value } as Partial<Defaults>);
  }

  async function setAccountFlag(
    accountId: string,
    patch: Partial<Omit<AccountAiSettings, 'accountId'>>
  ) {
    const cur =
      accountSettings[accountId] ?? {
        accountId,
        enabled: false,
        mode: defaults?.mode ?? 'suggest',
        maxPerHour: 10,
        maxPerDay: 50,
      };
    const next: AccountAiSettings = { ...cur, ...patch };
    const saved = await b2dm.ai.setAccountSettings(next);
    setAccountSettings((prev) => ({ ...prev, [accountId]: saved }));
  }

  if (!settings || !defaults) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <h1 className="text-base font-semibold">AI Auto-Responder</h1>
          <p className="text-xs text-muted-foreground">
            Anthropic Claude · {settings.hasApiKey ? 'API key configured' : 'API key required (see Settings)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={defaults.killSwitch}
              onChange={(e) => void setDefaultsField('killSwitch', e.target.checked)}
            />
            <Power className="h-3.5 w-3.5" />
            Pause all AI replies
          </label>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[1fr_360px] divide-x divide-border overflow-hidden">
        {/* Left — prompt editor */}
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="text-xs text-muted-foreground">
              Edit the system prompt the AI uses for every reply. Tokens{' '}
              <code className="rounded bg-muted px-1">{'{{account_username}}'}</code> and{' '}
              <code className="rounded bg-muted px-1">{'{{history_depth}}'}</code> are substituted at request time.
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPrompt(loadedDefaultMd)}
                title="Replace with the shipped default"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void savePrompt()}
                disabled={savingPrompt}
              >
                {savingPrompt ? <Spinner className="h-3 w-3" /> : <Save className="h-3 w-3" />}
                Save
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden p-4" data-color-mode="light">
            <MDEditor
              value={prompt}
              onChange={(v) => setPrompt(v ?? '')}
              height={600}
              preview="live"
              hideToolbar={false}
              visibleDragbar={false}
            />
            {savedPromptAt ? (
              <div className="mt-2 text-[11px] text-muted-foreground">
                Saved at {new Date(savedPromptAt).toLocaleTimeString()}
              </div>
            ) : null}
          </div>
        </div>

        {/* Right — settings + per-account toggles */}
        <div className="space-y-4 overflow-y-auto p-4">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Defaults
            </h2>
            <div className="mt-2 space-y-3">
              <div>
                <Label className="text-xs">History depth ({defaults.historyDepth})</Label>
                <input
                  type="range"
                  min={4}
                  max={40}
                  step={1}
                  value={defaults.historyDepth}
                  onChange={(e) =>
                    void setDefaultsField('historyDepth', Number(e.target.value))
                  }
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-xs">Default mode</Label>
                <div className="mt-1 flex gap-2">
                  {(['suggest', 'auto'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => void setDefaultsField('mode', m)}
                      className={cn(
                        'flex-1 rounded border px-2 py-1 text-xs',
                        defaults.mode === m
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:bg-muted/30'
                      )}
                    >
                      {m === 'suggest' ? 'Suggest only' : 'Auto-send'}
                    </button>
                  ))}
                </div>
                {defaults.mode === 'auto' ? (
                  <div className="mt-1 flex items-start gap-1 text-[11px] text-amber-600">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    Auto-send will reply automatically. Use account-level rate limits to bound it.
                  </div>
                ) : null}
              </div>
              <div>
                <Label className="text-xs">Min inbound length (chars)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={defaults.minInboundLen}
                  onChange={(e) =>
                    void setDefaultsField('minInboundLen', Number(e.target.value))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Max consecutive AI replies</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={defaults.maxAiStreak}
                  onChange={(e) =>
                    void setDefaultsField('maxAiStreak', Number(e.target.value))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Exclude keywords (one per line)</Label>
                <textarea
                  value={defaults.excludeKeywords.join('\n')}
                  onChange={(e) =>
                    void setDefaultsField(
                      'excludeKeywords',
                      e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
                    )
                  }
                  className="min-h-[60px] w-full rounded border border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-primary"
                  placeholder="unsubscribe&#10;stop"
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              This month
            </h2>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded border border-border p-2">
                <div className="text-base font-semibold">{cost?.monthSentCount ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">sent</div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-base font-semibold">{cost?.monthSuggestedCount ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">suggested</div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-base font-semibold">
                  ${(cost?.monthCostUsd ?? 0).toFixed(2)}
                </div>
                <div className="text-[10px] text-muted-foreground">cost</div>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void reloadCost()}
              className="mt-2 w-full"
            >
              Refresh
            </Button>
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Per-account
            </h2>
            <div className="mt-2 space-y-2">
              {accounts.length === 0 ? (
                <div className="text-xs text-muted-foreground">No accounts connected.</div>
              ) : (
                accounts.map((a) => {
                  const cfg =
                    accountSettings[a.id] ?? {
                      accountId: a.id,
                      enabled: false,
                      mode: defaults.mode,
                      maxPerHour: 10,
                      maxPerDay: 50,
                    };
                  return (
                    <div key={a.id} className="rounded border border-border p-2 text-xs">
                      <div className="flex items-center gap-2">
                        {a.profilePicUrl ? (
                          <img src={a.profilePicUrl} alt="" className="h-6 w-6 rounded-full" />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-muted" />
                        )}
                        <div className="min-w-0 flex-1 truncate">@{a.username}</div>
                        <label className="flex items-center gap-1 text-[11px]">
                          <input
                            type="checkbox"
                            checked={cfg.enabled}
                            onChange={(e) =>
                              void setAccountFlag(a.id, { enabled: e.target.checked })
                            }
                          />
                          <Sparkles className="h-3 w-3" /> AI on
                        </label>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">Mode</Label>
                          <select
                            value={cfg.mode}
                            onChange={(e) =>
                              void setAccountFlag(a.id, {
                                mode: e.target.value as ResponderMode,
                              })
                            }
                            className="h-7 w-full rounded border border-border bg-transparent text-xs"
                          >
                            <option value="suggest">Suggest</option>
                            <option value="auto">Auto-send</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-[10px]">Max/hour</Label>
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            value={cfg.maxPerHour}
                            onChange={(e) =>
                              void setAccountFlag(a.id, {
                                maxPerHour: Number(e.target.value),
                              })
                            }
                            className="h-7"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Max/day</Label>
                          <Input
                            type="number"
                            min={1}
                            max={1000}
                            value={cfg.maxPerDay}
                            onChange={(e) =>
                              void setAccountFlag(a.id, {
                                maxPerDay: Number(e.target.value),
                              })
                            }
                            className="h-7"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="border-t border-border px-6 py-2 text-[11px] text-muted-foreground">
        {models.length > 0 ? (
          <>
            Models available: {models.map((m) => m.label).join(' · ')}. Change in Settings → AI provider.
          </>
        ) : null}
      </div>
    </div>
  );
}
