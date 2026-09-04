import { CHAT_STYLE_LABELS, DEFAULT_CHAT_STYLE, isChatStyle, type ChatStyle } from '@plusplusoneplusplus/coc-client';
import { CHAT_STYLE_FOCUS_LINES, resolveChatStylePrompt } from '../../config/chat-style-prompts';
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
 * The per-style prompt text — built-in defaults plus any admin override — lives
 * in `config/chat-style-prompts.ts` so the admin SPA can render the same
 * strings. Re-exported here because this module is the historical home and
 * every server import points at it.
 */
export { CHAT_STYLE_FOCUS_LINES };

/**
 * Live read of `features.chatStylePrompts`. Registered once at server start,
 * mirroring how the chat-style feature flag and default style are wired: the
 * injector stays synchronous and never touches the config file itself.
 */
let chatStylePromptOverridesProvider: (() => unknown) | undefined;

/** Install the live override reader. Pass `undefined` to fall back to built-ins. */
export function setChatStylePromptOverridesProvider(provider: (() => unknown) | undefined): void {
    chatStylePromptOverridesProvider = provider;
}

/**
 * Current overrides, or `undefined` when none are readable. A throwing or
 * malformed provider degrades to the built-in defaults — style injection must
 * never fail a chat.
 */
function readChatStylePromptOverrides(): unknown {
    if (!chatStylePromptOverridesProvider) {
        return undefined;
    }
    try {
        return chatStylePromptOverridesProvider();
    } catch {
        return undefined;
    }
}

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
  const focus = resolveChatStylePrompt(style, readChatStylePromptOverrides());
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
 * Narrow an untrusted value to a {@link ChatStyle}, falling back to `'default'`.
 * Used wherever a stored or configured value reaches code that needs a concrete
 * style — config reads, metadata reads, wire payloads.
 */
export function coerceChatStyle(value: unknown): ChatStyle {
    return isChatStyle(value) ? value : DEFAULT_CHAT_STYLE;
}

/**
 * The style recorded for a conversation so far. A conversation that never
 * recorded one starts at `'default'`, which is what makes the very first turn
 * inject whenever the user picked a real style.
 */
export function recordedChatStyle(metadata: Record<string, unknown> | undefined): ChatStyle {
    return coerceChatStyle(metadata?.chatStyle);
}

/**
 * The single injection rule: inject when the style selected for this turn
 * differs from the style last recorded for the conversation and is not
 * `'default'`. Switching *to* Default deliberately emits nothing.
 */
export function shouldInjectChatStyle(selected: ChatStyle, recorded: ChatStyle): boolean {
    return selected !== DEFAULT_CHAT_STYLE && selected !== recorded;
}
