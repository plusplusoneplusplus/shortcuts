/**
 * Grounded prompt builder for Quick Ask side-notes.
 *
 * The lookup is a cheap one-shot ask (not a follow-up turn), so the prompt is
 * deliberately compact: the selected phrase plus a short surrounding snippet
 * for grounding, and an instruction to answer briefly.
 */

/** Max chars of the selected phrase forwarded to the model. */
const MAX_SELECTION_CHARS = 400;
/** Max chars of surrounding context forwarded on each side. */
const MAX_CONTEXT_CHARS = 400;

export interface SideNotePromptInput {
    /** The selected phrase/term to explain. */
    selectedText: string;
    /** Text immediately before the selection (grounding only). */
    contextBefore?: string;
    /** Text immediately after the selection (grounding only). */
    contextAfter?: string;
    /** Optional custom question; defaults to a brief explanation. */
    question?: string;
}

function truncate(text: string, max: number): string {
    const t = (text ?? '').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
}

/**
 * Build the compact grounded prompt sent to the one-shot invoker.
 */
export function buildSideNotePrompt(input: SideNotePromptInput): string {
    const selection = truncate(input.selectedText, MAX_SELECTION_CHARS);
    const before = truncate(input.contextBefore ?? '', MAX_CONTEXT_CHARS);
    const after = truncate(input.contextAfter ?? '', MAX_CONTEXT_CHARS);
    const snippet = [before, `⟦${selection}⟧`, after].filter(Boolean).join(' ');

    const ask = input.question?.trim()
        ? input.question.trim()
        : `Briefly explain "${selection}" in 1-3 sentences.`;

    return [
        'You are answering a quick side-question about a phrase highlighted inside a chat message.',
        'Answer concisely in Markdown. Do not restate the question. No preamble.',
        '',
        'Surrounding passage (the highlighted phrase is wrapped in ⟦ ⟧):',
        snippet,
        '',
        `Question: ${ask}`,
    ].join('\n');
}
