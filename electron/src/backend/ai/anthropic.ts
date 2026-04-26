// Anthropic SDK wrapper. The provider abstraction in ./index.ts calls into
// here. When a new model ships, update ANTHROPIC_MODELS — the dropdown in
// Settings, the cost estimator, and the test-call all read from this list.
//
// Prompt caching is enabled on the system block: the user's prompt is large
// and repeated across many requests in a session, so we get ~10x cheaper
// effective input cost on the second and subsequent calls.

import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn, GenerateReplyResult } from './index';

export type AnthropicModelId =
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'
  | 'claude-haiku-4-5';

export interface AnthropicModelInfo {
  id: AnthropicModelId;
  label: string;
  description: string;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  cacheReadCostPerMTok: number;
  cacheWriteCostPerMTok: number;
}

export const ANTHROPIC_MODELS: AnthropicModelInfo[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6 (default)',
    description: 'Balanced quality and cost. Right default for DM replies.',
    inputCostPerMTok: 3.0,
    outputCostPerMTok: 15.0,
    cacheReadCostPerMTok: 0.3,
    cacheWriteCostPerMTok: 3.75,
  },
  {
    id: 'claude-opus-4-7',
    label: 'Opus 4.7 (highest quality)',
    description: 'Strongest reasoning. ~5x cost vs Sonnet.',
    inputCostPerMTok: 5.0,
    outputCostPerMTok: 25.0,
    cacheReadCostPerMTok: 0.5,
    cacheWriteCostPerMTok: 6.25,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5 (fastest, cheapest)',
    description: 'High volume, simple replies. ~5x cheaper vs Sonnet.',
    inputCostPerMTok: 1.0,
    outputCostPerMTok: 5.0,
    cacheReadCostPerMTok: 0.1,
    cacheWriteCostPerMTok: 1.25,
  },
];

interface GenerateArgs {
  apiKey: string;
  model: AnthropicModelId;
  maxTokens: number;
  systemPrompt: string;
  history: ConversationTurn[];
  newMessage: string;
}

// Anthropic requires alternating user/assistant turns starting with user. We
// collapse consecutive same-role turns by joining their bodies, then append
// the new inbound message as the final user turn. If the history happens to
// end with a user turn already, the new message is concatenated to it (still
// one user turn at the tail).
function buildMessages(history: ConversationTurn[], newMessage: string): Anthropic.MessageParam[] {
  const collapsed: ConversationTurn[] = [];
  for (const turn of history) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.role === turn.role) {
      last.body = `${last.body}\n\n${turn.body}`;
    } else {
      collapsed.push({ role: turn.role, body: turn.body });
    }
  }
  // Anthropic requires the first message to be 'user'. If history starts with
  // an assistant turn (rare — happens when we backfilled an outbound-only
  // thread), drop it. The model still has the system prompt for context.
  while (collapsed.length > 0 && collapsed[0]!.role !== 'user') {
    collapsed.shift();
  }
  // Append new inbound message as the trailing user turn.
  const tail = collapsed[collapsed.length - 1];
  if (tail && tail.role === 'user') {
    tail.body = `${tail.body}\n\n${newMessage}`;
  } else {
    collapsed.push({ role: 'user', body: newMessage });
  }
  return collapsed.map((t) => ({ role: t.role, content: t.body }));
}

export async function generateReply(args: GenerateArgs): Promise<GenerateReplyResult> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const messages = buildMessages(args.history, args.newMessage);

  const response = await client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens,
    system: [
      {
        type: 'text',
        text: args.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  });

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text'
  );
  const text = textBlocks.map((b) => b.text).join('').trim();

  const usage = response.usage;
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const costUsd = estimateCostUsd(
    args.model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens
  );

  return {
    text,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    costUsd,
    model: response.model,
  };
}

export async function testApiKey(
  apiKey: string,
  model: AnthropicModelId
): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 4,
      messages: [{ role: 'user', content: 'hi' }],
    });
    return { ok: true, model: response.model };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `${err.status} ${err.message}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function estimateCostUsd(
  modelId: AnthropicModelId,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens = 0,
  cacheReadTokens = 0
): number {
  const m = ANTHROPIC_MODELS.find((x) => x.id === modelId);
  if (!m) return 0;
  const cost =
    (inputTokens / 1_000_000) * m.inputCostPerMTok +
    (outputTokens / 1_000_000) * m.outputCostPerMTok +
    (cacheCreationTokens / 1_000_000) * m.cacheWriteCostPerMTok +
    (cacheReadTokens / 1_000_000) * m.cacheReadCostPerMTok;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
