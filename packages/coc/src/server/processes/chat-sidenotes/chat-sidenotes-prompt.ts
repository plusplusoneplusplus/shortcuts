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
    /**
     * Full extracted paper text for whole-paper grounding (Goal 3, AC-04).
     * When present, the answer is grounded on the entire paper rather than just
     * the ±context window. Assumed pre-budgeted by the caller.
     */
    paperText?: string;
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

    // Whole-paper grounding path (Goal 3, AC-04): the model reads the full paper
    // text, not just the ±context window, so it can answer questions the local
    // snippet alone can't ground.
    const paperText = (input.paperText ?? '').trim();
    if (paperText) {
        return [
            'You are answering a question about a highlighted passage in a research paper.',
            'Ground your answer in the full paper text below — not only the immediately surrounding lines.',
            'Answer concisely in Markdown. Do not restate the question. No preamble.',
            '',
            'Highlighted passage (wrapped in ⟦ ⟧ within its surrounding lines):',
            snippet,
            '',
            'Full paper text:',
            paperText,
            '',
            `Question: ${ask}`,
        ].join('\n');
    }

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

/** Grounding input for a figure/equation region-crop ask (Goal 4 AC-01). */
export interface RegionAskPromptInput {
    /** Optional custom question; defaults to a brief explanation of the region. */
    question?: string;
    /** Page text immediately before the region (grounding only). */
    contextBefore?: string;
    /** Page text immediately after the region (grounding only). */
    contextAfter?: string;
}

/**
 * Build the prompt for a figure/equation region-crop lookup.
 *
 * The cropped region is delivered as an image attachment, not text, so the
 * prompt tells the model to read the attached image and (optionally) grounds it
 * on any page text captured around the box.
 */
export function buildRegionAskPrompt(input: RegionAskPromptInput): string {
    const before = truncate(input.contextBefore ?? '', MAX_CONTEXT_CHARS);
    const after = truncate(input.contextAfter ?? '', MAX_CONTEXT_CHARS);
    const context = [before, after].filter(Boolean).join(' … ');

    const ask = input.question?.trim()
        ? input.question.trim()
        : 'Explain this figure or equation from the paper in 1-3 sentences.';

    const lines = [
        'You are answering a question about a figure or equation region cropped from a research paper.',
        'The cropped region is attached as an image. Read it and answer concisely in Markdown. Do not restate the question. No preamble.',
    ];
    if (context) {
        lines.push('', 'Nearby page text (for context):', context);
    }
    lines.push('', `Question: ${ask}`);
    return lines.join('\n');
}
