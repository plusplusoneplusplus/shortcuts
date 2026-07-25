/**
 * paperChatGrounding — whole-paper grounding for the Notes chat (Goal 3, AC-03).
 *
 * A note can embed an ingested arXiv paper (`.papers/<id>.pdf`, cached by the
 * server ingest handler) whose full text was extracted once into a sibling
 * `.papers/<id>.txt` sidecar. A "💬 Chat about this paper" action on the embed
 * starts (or reuses) the per-note chat and prepends a grounding directive to the
 * first message so the `NoteChatExecutor` reads the whole extracted text with its
 * file tools — the agentic path→model-reads-file pattern, not the cheap ±context
 * window that selection Ask uses by default.
 *
 * This mirrors how `useNotesChat` prepends the note attachment link: the CLIENT
 * puts a readable path in the prompt; the model resolves it against the notes
 * root (surfaced to it via the chat auto-folder context) and reads the file.
 *
 * Pure; no DOM.
 */

import { paperPathFromPdfUrl } from './paperPathFromUrl';

/**
 * Recover the cached paper's `.txt` sidecar relpath from a rendered PDF embed
 * URL, or `undefined` when the URL is not a cached-paper embed (uploaded PDF,
 * external hotlink, malformed URL) — in which case the action is not offered.
 *
 * Reuses {@link paperPathFromPdfUrl} (which validates single-basename under the
 * `.papers/` cache, `.pdf` ext, no traversal) and swaps the extension to `.txt`,
 * matching the server's `paperTextSidecarRelPath` mapping.
 */
export function paperTextPathFromPdfUrl(pdfUrl: string | undefined | null): string | undefined {
    const pdfRel = paperPathFromPdfUrl(pdfUrl);
    if (!pdfRel) { return undefined; }
    return pdfRel.replace(/\.pdf$/i, '.txt');
}

/**
 * Build the whole-paper grounding directive prepended to the outgoing Notes-chat
 * message. Returns an empty string for a blank path so callers can safely fold it
 * into a `pendingPrefix` alongside other prefixes.
 */
export function formatPaperChatGrounding(paperTextRelPath: string): string {
    const p = paperTextRelPath.trim();
    if (!p) { return ''; }
    return (
        `<paper_reference path="${p}">\n` +
        `The full extracted text of this paper is saved at \`${p}\` (relative to the notes root). ` +
        `Read that file with your file tools to ground your answer in the complete paper, not just this note.\n` +
        `</paper_reference>\n\n`
    );
}
