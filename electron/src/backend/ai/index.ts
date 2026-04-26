// Provider abstraction for the AI auto-responder. The Anthropic implementation
// lives in ./anthropic.ts. When OpenAI (or any other provider) lands, add a
// sibling file and gate it on a stored provider preference — no caller needs
// to change.

import { metaGet, metaSet, metaGetJson, metaSetJson } from '../db';
import { encryptString, decryptString } from '../crypto';
import {
  ANTHROPIC_MODELS,
  type AnthropicModelId,
  generateReply as generateReplyAnthropic,
  testApiKey as testApiKeyAnthropic,
  estimateCostUsd as estimateCostUsdAnthropic,
} from './anthropic';

export type AiProviderId = 'anthropic';

export interface AiSettings {
  provider: AiProviderId;
  model: AnthropicModelId;
  defaultMaxTokens: number;
  hasApiKey: boolean;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  body: string;
}

export interface GenerateReplyArgs {
  systemPrompt: string;
  history: ConversationTurn[];
  newMessage: string;
  maxTokens?: number;
  modelOverride?: AnthropicModelId;
}

export interface GenerateReplyResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  model: string;
}

const META_KEY_API_KEY = 'ai_anthropic_api_key_encrypted';
const META_KEY_PROVIDER = 'ai_provider';
const META_KEY_MODEL = 'ai_model';
const META_KEY_MAX_TOKENS = 'ai_max_tokens';
const META_KEY_PROMPT = 'ai_prompt_md';
const META_KEY_HISTORY_DEPTH = 'ai_history_depth';
const META_KEY_MODE = 'ai_mode_default';
const META_KEY_KILL_SWITCH = 'ai_kill_switch';
const META_KEY_EXCLUDE_KEYWORDS = 'ai_exclude_keywords';
const META_KEY_MIN_INBOUND_LEN = 'ai_min_inbound_len';
const META_KEY_MAX_AI_STREAK = 'ai_max_streak';

const DEFAULT_MODEL: AnthropicModelId = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_HISTORY_DEPTH = 12;

export function getApiKey(): string | null {
  const raw = metaGet(META_KEY_API_KEY);
  if (!raw) return null;
  try {
    return decryptString(Buffer.from(raw, 'base64'));
  } catch {
    return null;
  }
}

export function setApiKey(plain: string | null): void {
  if (!plain || plain.trim().length === 0) {
    metaSet(META_KEY_API_KEY, null);
    return;
  }
  const blob = encryptString(plain.trim());
  metaSet(META_KEY_API_KEY, blob.toString('base64'));
}

export function getSettings(): AiSettings {
  const provider = (metaGet(META_KEY_PROVIDER) as AiProviderId | null) ?? 'anthropic';
  const model = (metaGet(META_KEY_MODEL) as AnthropicModelId | null) ?? DEFAULT_MODEL;
  const maxTokens = Number(metaGet(META_KEY_MAX_TOKENS)) || DEFAULT_MAX_TOKENS;
  return {
    provider,
    model: ANTHROPIC_MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL,
    defaultMaxTokens: Math.max(50, Math.min(1500, maxTokens)),
    hasApiKey: !!getApiKey(),
  };
}

export function setSettings(input: Partial<Omit<AiSettings, 'hasApiKey'>>): AiSettings {
  if (input.provider) metaSet(META_KEY_PROVIDER, input.provider);
  if (input.model) {
    if (!ANTHROPIC_MODELS.some((m) => m.id === input.model)) {
      throw new Error(`Unknown model: ${input.model}`);
    }
    metaSet(META_KEY_MODEL, input.model);
  }
  if (typeof input.defaultMaxTokens === 'number') {
    const clamped = Math.max(50, Math.min(1500, Math.floor(input.defaultMaxTokens)));
    metaSet(META_KEY_MAX_TOKENS, String(clamped));
  }
  return getSettings();
}

export function listModels() {
  return ANTHROPIC_MODELS;
}

export function getPromptMd(defaultMd: string): string {
  return metaGet(META_KEY_PROMPT) ?? defaultMd;
}

export function setPromptMd(md: string): void {
  metaSet(META_KEY_PROMPT, md ?? '');
}

export function getHistoryDepth(): number {
  const n = Number(metaGet(META_KEY_HISTORY_DEPTH)) || DEFAULT_HISTORY_DEPTH;
  return Math.max(4, Math.min(40, Math.floor(n)));
}

export function setHistoryDepth(n: number): void {
  metaSet(META_KEY_HISTORY_DEPTH, String(Math.max(4, Math.min(40, Math.floor(n)))));
}

export type ResponderMode = 'suggest' | 'auto';

export function getDefaultMode(): ResponderMode {
  const raw = metaGet(META_KEY_MODE);
  return raw === 'auto' ? 'auto' : 'suggest';
}

export function setDefaultMode(mode: ResponderMode): void {
  metaSet(META_KEY_MODE, mode === 'auto' ? 'auto' : 'suggest');
}

export function getKillSwitch(): boolean {
  return metaGet(META_KEY_KILL_SWITCH) === 'true';
}

export function setKillSwitch(on: boolean): void {
  metaSet(META_KEY_KILL_SWITCH, on ? 'true' : 'false');
}

export function getExcludeKeywords(): string[] {
  return metaGetJson<string[]>(META_KEY_EXCLUDE_KEYWORDS) ?? ['unsubscribe', 'stop'];
}

export function setExcludeKeywords(list: string[]): void {
  metaSetJson(META_KEY_EXCLUDE_KEYWORDS, list.map((s) => s.trim()).filter(Boolean));
}

export function getMinInboundLen(): number {
  const n = Number(metaGet(META_KEY_MIN_INBOUND_LEN));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
}

export function setMinInboundLen(n: number): void {
  metaSet(META_KEY_MIN_INBOUND_LEN, String(Math.max(0, Math.min(100, Math.floor(n)))));
}

export function getMaxAiStreak(): number {
  const n = Number(metaGet(META_KEY_MAX_AI_STREAK));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

export function setMaxAiStreak(n: number): void {
  metaSet(META_KEY_MAX_AI_STREAK, String(Math.max(1, Math.min(50, Math.floor(n)))));
}

export async function generateReply(args: GenerateReplyArgs): Promise<GenerateReplyResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Anthropic API key is not configured');
  const settings = getSettings();
  const model = args.modelOverride ?? settings.model;
  return generateReplyAnthropic({
    apiKey,
    model,
    maxTokens: args.maxTokens ?? settings.defaultMaxTokens,
    systemPrompt: args.systemPrompt,
    history: args.history,
    newMessage: args.newMessage,
  });
}

export async function testApiKey(apiKey: string, model?: AnthropicModelId): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  return testApiKeyAnthropic(apiKey, model ?? getSettings().model);
}

export function estimateCostUsd(modelId: AnthropicModelId, inputTokens: number, outputTokens: number, cacheCreationTokens = 0, cacheReadTokens = 0): number {
  return estimateCostUsdAnthropic(modelId, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);
}
