import { CHAT_STYLE_LABELS, DEFAULT_CHAT_STYLE, isChatStyle, type ChatStyle } from '@plusplusoneplusplus/coc-client';
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import { CHAT_STYLE_FOCUS_LINES, resolveChatStylePrompt } from '../../config/chat-style-prompts';
import { hasCompactionSince } from './conversation-context-invalidation';
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

/** Selector state; execution context is tracked separately in `chatStyleContext`. */
export function recordedChatStyle(metadata: Record<string, unknown> | undefined): ChatStyle {
    return coerceChatStyle(metadata?.chatStyle);
}

export interface ChatStyleContext {
    style: ChatStyle;
    block?: string;
    turnIndex: number;
    /** A queued user turn can precede the compaction result that execution already observed. */
    throughTurnIndex: number;
    injectedAt: string;
}

/** Tracks executed style, separately from the selector state written at admission. */
export function buildChatStyleContext(style: ChatStyle, block: string | undefined, turnIndex: number, throughTurnIndex = turnIndex): ChatStyleContext {
    return { style, block, turnIndex, throughTurnIndex, injectedAt: new Date().toISOString() };
}

/**
 * Like mode directives, a stable native session needs no repeated block.
 * Restore it after compaction, a history rebuild, a style change or prompt drift.
 * Default always emits nothing, including after compaction.
 */
export function shouldInjectChatStyle(
    selected: ChatStyle,
    block: string | undefined,
    process: AIProcess | undefined,
    canResumeSession: boolean,
): boolean {
    if (!block || selected === DEFAULT_CHAT_STYLE) return false;
    if (!canResumeSession) return true;
    const context = process?.metadata?.chatStyleContext;
    if (!context || typeof context !== 'object'
        || !('style' in context) || context.style !== selected
        || !('block' in context) || context.block !== block
        || !('turnIndex' in context) || typeof context.turnIndex !== 'number'
        || !('throughTurnIndex' in context) || typeof context.throughTurnIndex !== 'number'
        || !('injectedAt' in context) || typeof context.injectedAt !== 'string') return true;
    const turns = process?.conversationTurns ?? [];
    const index = turns.findIndex(turn => turn.turnIndex === context.turnIndex);
    if (index < 0 || turns[index].role !== 'user' || !turns[index].content.startsWith(block)) return true;
    const throughIndex = turns.findIndex(turn => turn.turnIndex === context.throughTurnIndex);
    if (throughIndex < index) return true;
    return hasCompactionSince(turns, throughIndex, context.injectedAt, process?.metadata?.compaction);
}

/** The executor records only the style it applies to the exact accepted user turn. */
export async function persistChatStyleOnUserTurn(
    store: ProcessStore,
    processId: string,
    style: ChatStyle,
    block: string | undefined,
    acceptedTurnIndex?: number,
): Promise<void> {
    const process = await store.getProcess(processId);
    if (!process) throw new Error('Chat style process is unavailable');
    const turns = process.conversationTurns ?? [];
    let index = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].role === 'user' && (acceptedTurnIndex === undefined || turns[i].turnIndex === acceptedTurnIndex)) {
            index = i;
            break;
        }
    }
    if (index < 0) throw new Error('Chat style user turn is unavailable');
    if (block && !turns[index].content.startsWith(`${block}\n\n`)) {
        await store.updateTurnContent(processId, index, `${block}\n\n${turns[index].content}`);
    }
    const current = await store.getProcess(processId);
    if (!current) throw new Error('Chat style process is unavailable');
    await store.updateProcess(processId, {
        metadata: {
            ...current.metadata,
            type: current.metadata?.type ?? 'chat',
            chatStyleContext: buildChatStyleContext(style, block, turns[index].turnIndex, turns.at(-1)!.turnIndex),
        },
    });
}
