/**
 * Chat Style Instructions
 *
 * Pure builders for the optional `<chat-style>` system-message block. Style
 * controls how a response is *written* — never the provider, model, reasoning
 * effort, tools, permission mode, or any structured output contract.
 *
 * The emitted text is a versioned product contract: `chat-style.test.ts`
 * asserts it verbatim, so treat wording changes as product changes.
 *
 * The block carries no shared preamble — only the selected label and one focus
 * line. General tone guidance and the rule that style never outranks runtime
 * rules, permissions, repo/skill instructions, safety rules, or output contracts
 * already reach the model from the admin global system prompt and the agent
 * harness, so a baseline here would be a third copy.
 *
 * Pure Node.js; no I/O. Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ChatStyle } from '@plusplusoneplusplus/coc-client';
import { isChatStyle } from '@plusplusoneplusplus/coc-client';

/** Tag wrapping the response-style block. Also identifies it in Conversation Metadata. */
export const CHAT_STYLE_SYSTEM_TAG = 'chat-style';

/** Human-readable label used in the block and in Conversation Metadata. */
const CHAT_STYLE_LABELS: Record<ChatStyle, string> = {
    human: 'Human',
    direct: 'Direct',
    analytical: 'Analytical',
    structured: 'Structured',
};

/** One short focus instruction per style, the whole body of the block. */
const CHAT_STYLE_FOCUS: Record<ChatStyle, string> = {
    human:
        'Write like a helpful coworker in a normal conversation. Keep the flow natural and let the wording carry the answer instead of structure.',
    direct:
        'Lead with the answer or action. Use the fewest words that preserve important facts. Cut preamble, softening, repetition, and background the user did not ask for.',
    analytical:
        'Explain the reasoning. Surface assumptions, evidence, causes, alternatives, and tradeoffs, and say what the risks are. Give a useful summary of the reasoning and its conclusions rather than a raw transcript of your internal thinking.',
    structured:
        'Make the answer easy to scan: outcome, key points, decisions, risks, and next steps. Only organize this way when the answer benefits from it, and never pad a one-line answer into a template. Do not invent owners, dates, decisions, risks, or certainty the context does not support.',
};

/** Display label for a style, for Conversation Metadata and UI copy. */
export function chatStyleLabel(style: ChatStyle): string {
    return CHAT_STYLE_LABELS[style];
}

/**
 * Build the `<chat-style>` system-message block.
 *
 * Returns `undefined` when the feature is disabled, no style was selected, or
 * the value is not one of the stable wire values — so every caller can append
 * the result unconditionally and stay inert by default.
 */
export function buildChatStyleSystemMessage(
    style: string | undefined,
    enabled: boolean,
): string | undefined {
    if (!enabled) return undefined;
    if (!isChatStyle(style)) return undefined;

    return [
        `<${CHAT_STYLE_SYSTEM_TAG}>`,
        `Selected style: ${CHAT_STYLE_LABELS[style]}.`,
        CHAT_STYLE_FOCUS[style],
        `</${CHAT_STYLE_SYSTEM_TAG}>`,
    ].join('\n');
}
