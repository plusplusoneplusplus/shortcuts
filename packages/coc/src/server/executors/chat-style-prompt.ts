import { CHAT_STYLE_LABELS, isChatStyle, type ChatStyle } from '@plusplusoneplusplus/coc-client';

/**
 * One focus line per real style. `'default'` deliberately has no entry: Default
 * means the model is told nothing at all about how to write.
 */
const CHAT_STYLE_FOCUS_LINES: Readonly<Partial<Record<ChatStyle, string>>> = {
  human:
    'Write like a helpful coworker in a normal conversation. Keep the flow natural and let the wording carry the answer instead of structure.',
  direct:
    'Lead with the answer or action. Use the fewest words that preserve important facts. Cut preamble, softening, repetition, and background the user did not ask for.',
  analytical:
    'Explain the reasoning. Surface assumptions, evidence, causes, alternatives, and tradeoffs, and say what the risks are. Give a useful summary of the reasoning and its conclusions rather than a raw transcript of your internal thinking.',
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
