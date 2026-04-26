import { useEffect, useState } from 'react';
import { Loader, Save, Sparkles } from 'lucide-react';
import { b2dm } from '@/lib/b2dm';
import type { AiSettings, AnthropicModelId, AnthropicModelInfo } from '@/types/domain';

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {title}
    </div>
  );
}

export function AiProviderSection() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [models, setModels] = useState<AnthropicModelInfo[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([b2dm.ai.getSettings(), b2dm.ai.listModels()]).then(([s, m]) => {
      setSettings(s);
      setModels(m);
    });
  }, []);

  async function saveKey() {
    if (apiKey.trim().length === 0) return;
    setSaving(true);
    try {
      const next = await b2dm.ai.setApiKey(apiKey.trim());
      setSettings(next);
      setApiKey('');
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    if (!confirm('Remove stored Anthropic API key?')) return;
    setSaving(true);
    try {
      const next = await b2dm.ai.setApiKey(null);
      setSettings(next);
    } finally {
      setSaving(false);
    }
  }

  async function testKey() {
    if (apiKey.trim().length === 0) {
      setTestResult('Enter a key first');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await b2dm.ai.testApiKey({ apiKey: apiKey.trim(), model: settings?.model });
      setTestResult(r.ok ? `OK — ${r.model}` : `Failed: ${r.error}`);
    } finally {
      setTesting(false);
    }
  }

  async function setModel(model: AnthropicModelId) {
    if (!settings) return;
    const next = await b2dm.ai.setSettings({ model });
    setSettings(next);
  }

  async function setMaxTokens(n: number) {
    if (!settings) return;
    const next = await b2dm.ai.setSettings({ defaultMaxTokens: n });
    setSettings(next);
  }

  return (
    <div className="border border-border bg-background">
      <SectionHeader title="AI Provider (Anthropic Claude)" />
      <div className="space-y-3 p-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">
            API key {settings?.hasApiKey ? '✓ stored' : '— not set'}
          </div>
          <div className="mt-1 flex gap-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="h-9 flex-1 rounded border border-border bg-transparent px-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="h-9 rounded border border-border px-2 text-xs hover:bg-muted/30"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              onClick={() => void testKey()}
              disabled={testing || apiKey.trim().length === 0}
              className="h-9 rounded border border-border px-3 text-xs hover:bg-muted/30 disabled:opacity-50"
            >
              {testing ? <Loader className="h-3 w-3 animate-spin" /> : 'Test'}
            </button>
            <button
              type="button"
              onClick={() => void saveKey()}
              disabled={saving || apiKey.trim().length === 0}
              className="h-9 rounded bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
          {testResult ? (
            <div
              className={
                testResult.startsWith('OK')
                  ? 'mt-1 text-xs text-emerald-600'
                  : 'mt-1 text-xs text-red-600'
              }
            >
              {testResult}
            </div>
          ) : null}
          {settings?.hasApiKey ? (
            <button
              type="button"
              onClick={() => void clearKey()}
              className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Remove stored key
            </button>
          ) : null}
        </div>

        <div>
          <div className="text-xs text-muted-foreground">Default model</div>
          <select
            value={settings?.model ?? 'claude-sonnet-4-6'}
            onChange={(e) => void setModel(e.target.value as AnthropicModelId)}
            className="mt-1 h-9 w-full rounded border border-border bg-transparent px-2 text-sm"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {settings ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {models.find((m) => m.id === settings.model)?.description ?? ''}
            </div>
          ) : null}
        </div>

        <div>
          <div className="text-xs text-muted-foreground">Default max tokens per reply</div>
          <input
            type="number"
            min={50}
            max={1500}
            value={settings?.defaultMaxTokens ?? 400}
            onChange={(e) => void setMaxTokens(Number(e.target.value))}
            className="mt-1 h-9 w-full rounded border border-border bg-transparent px-2 text-sm"
          />
        </div>

        <div className="flex items-start gap-2 rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
          <Sparkles className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary" />
          <div>
            BYO key. The AI Auto-Responder uses this key for every reply. Edit your prompt and
            account toggles on the Auto-Responder screen.
          </div>
        </div>
      </div>
    </div>
  );
}
