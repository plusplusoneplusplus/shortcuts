import { CHAT_STYLE_LABELS, DEFAULT_CHAT_STYLE, isChatStyle, type ChatStyle } from '@plusplusoneplusplus/coc-client';
import type { ChatPayload } from '../tasks/task-types';
import {
    hasClassifyDiffContext,
    hasCommitChatContext,
    hasNoteChatContext,
    hasNoteCreateContext,
    hasReplicationContext,
    hasResolveCommentsContext,
    hasResolveDiffCommentsMultiContext,
    hasTaskGenerationContext,
    isChatPayload,
    normalizeChatModeOrDefault,
} from '../tasks/task-types';

/**
 * One focus line per real style. `'default'` deliberately has no entry: Default
 * means the model is told nothing at all about how to write.
 */
const CHAT_STYLE_FOCUS_LINES: Readonly<Partial<Record<ChatStyle, string>>> = {
  human:
    'Write like a helpful coworker in a normal conversation. Keep the flow natural and let the wording carry the answer instead of structure.',
  direct:
    'Lead with the answer or action, then only what the user needs to act on it. '
    + 'Short sentences, plain words. Cut preamble, softening, and background they did not ask for — short, not compressed.',
  structured:
    'Make the answer easy to scan: outcome, key points, decisions, risks, and next steps. Only organize this way when the answer benefits from it, and never pad a one-line answer into a template. Do not invent owners, dates, decisions, risks, or certainty the context does not support.',
};

/**
 * Build the four-line `<chat-style>` block for a style.
 *
 * Returns `undefined` for `'default'` and for any unknown value — those cases
 * carry no instruction at all.
 */
export function buildChatStyleBlock(style: unknown): string | undefined {
  if (!isChatStyle(style)) {
    return undefined;
  }
  const focus = CHAT_STYLE_FOCUS_LINES[style];
  if (!focus) {
    return undefined;
  }
  return `<chat-style>\nSelected style: ${CHAT_STYLE_LABELS[style]}.\n${focus}\n</chat-style>`;
}

/**
 * Prepend the style block to a user prompt, separated by a blank line. When the
 * style carries no block the prompt is returned byte-for-byte unchanged.
 */
export function prependChatStyleBlock(prompt: string, style: unknown): string {
  const block = buildChatStyleBlock(style);
  if (!block) {
    return prompt;
  }
  return `${block}\n\n${prompt}`;
}

/**
 * Whether a new-chat task payload is in scope for style injection.
 *
 * Mirrors `ExecutorRegistry.resolveChatExecutor`: only the four user-facing chat
 * executors qualify — ask (`chat-base`), autopilot, commit-chat and note-chat.
 * Ralph, classification, task generation, note creation, resolve-comments,
 * replication, Dreams and workflows are all out of scope.
 */
export function isChatStyleEligiblePayload(payload: Record<string, unknown> | undefined): boolean {
    if (!payload || !isChatPayload(payload)) {
        return false;
    }
    if (
        hasTaskGenerationContext(payload)
        || hasReplicationContext(payload)
        || hasResolveCommentsContext(payload)
        || hasResolveDiffCommentsMultiContext(payload)
        || hasClassifyDiffContext(payload)
        || hasNoteCreateContext(payload)
        || (payload as ChatPayload).tools?.includes('resolve-comments')
    ) {
        return false;
    }
    if (hasCommitChatContext(payload) || hasNoteChatContext(payload)) {
        return true;
    }
    const mode = normalizeChatModeOrDefault((payload as ChatPayload).mode);
    return mode === 'ask' || mode === 'autopilot';
}

/**
 * The style recorded for a conversation so far. A conversation that never
 * recorded one starts at `'default'`, which is what makes the very first turn
 * inject whenever the user picked a real style.
 */
export function recordedChatStyle(metadata: Record<string, unknown> | undefined): ChatStyle {
    const stored = metadata?.chatStyle;
    return isChatStyle(stored) ? stored : DEFAULT_CHAT_STYLE;
}

/**
 * The single injection rule: inject when the style selected for this turn
 * differs from the style last recorded for the conversation and is not
 * `'default'`. Switching *to* Default deliberately emits nothing.
 */
export function shouldInjectChatStyle(selected: ChatStyle, recorded: ChatStyle): boolean {
    return selected !== DEFAULT_CHAT_STYLE && selected !== recorded;
}
