/**
 * Chat-style prompt text — built-in defaults, admin overrides, and resolution.
 *
 * Lives in `config/` rather than beside the injector in
 * `server/executors/chat-style-prompt.ts` because the admin SPA has to render
 * the built-in text into its textareas, and the SPA can only import Node-free
 * modules from here (same rule as `admin-setting-definitions.ts`). The injector
 * re-exports {@link CHAT_STYLE_FOCUS_LINES} so server code keeps its old import.
 *
 * Only the three real styles are editable. `'default'` deliberately has no
 * prompt at all — Default means the model is told nothing about how to write —
 * so it is rejected as an override key.
 */

import type { ChatStyle } from '@plusplusoneplusplus/coc-client';

/** The styles that carry prompt text, and are therefore admin-editable. */
export const EDITABLE_CHAT_STYLES = ['human', 'direct', 'structured'] as const;

export type EditableChatStyle = typeof EDITABLE_CHAT_STYLES[number];

/** Per-style override cap. Long enough for a paragraph or two of guidance. */
export const CHAT_STYLE_PROMPT_MAX_LENGTH = 4000;

/** Flat config key for the overrides map. */
export const CHAT_STYLE_PROMPTS_KEY = 'features.chatStylePrompts';

/**
 * One focus line per real style — the built-in defaults an admin edits away
 * from. A config with no override must reproduce these byte-for-byte.
 */
export const CHAT_STYLE_FOCUS_LINES: Readonly<Record<EditableChatStyle, string>> = {
    human:
        'Write like a helpful coworker in a normal conversation. Keep the flow natural and let the wording carry the answer instead of structure.',
    direct:
        'Lead with the answer or action, then only what the user needs to act on it. '
        + 'Short sentences, plain words. Cut preamble, softening, and background they did not ask for — short, not compressed.',
    structured:
        'Make the answer easy to scan: outcome, key points, decisions, risks, and next steps. Only organize this way when the answer benefits from it, and never pad a one-line answer into a template. Do not invent owners, dates, decisions, risks, or certainty the context does not support.',
};

/** Admin-set prompt text, keyed by style. An absent key means "built-in". */
export type ChatStylePromptOverrides = Partial<Record<EditableChatStyle, string>>;

export function isEditableChatStyle(value: unknown): value is EditableChatStyle {
    return typeof value === 'string' && (EDITABLE_CHAT_STYLES as readonly string[]).includes(value);
}

/**
 * Validate a `features.chatStylePrompts` payload for PUT /api/admin/config.
 * Returns an error message, or undefined when the value is acceptable.
 */
export function validateChatStylePromptOverrides(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return `${CHAT_STYLE_PROMPTS_KEY} must be an object keyed by chat style`;
    }
    for (const [style, prompt] of Object.entries(value as Record<string, unknown>)) {
        if (!isEditableChatStyle(style)) {
            return `${CHAT_STYLE_PROMPTS_KEY}.${style} is not an editable chat style — expected one of: ${EDITABLE_CHAT_STYLES.join(', ')}`;
        }
        if (prompt === null || prompt === undefined) {
            continue;
        }
        if (typeof prompt !== 'string') {
            return `${CHAT_STYLE_PROMPTS_KEY}.${style} must be a string, or null to clear`;
        }
        if (prompt.length > CHAT_STYLE_PROMPT_MAX_LENGTH) {
            return `${CHAT_STYLE_PROMPTS_KEY}.${style} must be at most ${CHAT_STYLE_PROMPT_MAX_LENGTH} characters`;
        }
    }
    return undefined;
}

/**
 * Drop everything that does not name a real override: unknown keys, non-strings,
 * nulls, and values that are empty after trimming. Used both when persisting an
 * admin edit and when reading a hand-edited config file, so injection never has
 * to reason about malformed input.
 */
export function normalizeChatStylePromptOverrides(value: unknown): ChatStylePromptOverrides {
    const normalized: ChatStylePromptOverrides = {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return normalized;
    }
    for (const style of EDITABLE_CHAT_STYLES) {
        const prompt = (value as Record<string, unknown>)[style];
        if (typeof prompt !== 'string') {
            continue;
        }
        const trimmed = prompt.trim();
        if (trimmed.length > 0 && trimmed.length <= CHAT_STYLE_PROMPT_MAX_LENGTH) {
            normalized[style] = trimmed;
        }
    }
    return normalized;
}

/**
 * The prompt text actually injected for a style: the admin override when one is
 * set, otherwise the built-in default. `'default'` and unknown values resolve to
 * undefined, which is what makes `buildChatStyleBlock` emit nothing for them.
 */
export function resolveChatStylePrompt(style: ChatStyle | string, overrides: unknown): string | undefined {
    if (!isEditableChatStyle(style)) {
        return undefined;
    }
    return normalizeChatStylePromptOverrides(overrides)[style] ?? CHAT_STYLE_FOCUS_LINES[style];
}
