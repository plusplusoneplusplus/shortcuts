/**
 * Best-effort "scroll to a source line" for the rich NoteEditor (AC-04).
 *
 * The rich editor renders Markdown as a ProseMirror document, so a source
 * line number does not map to an exact DOM offset. Rather than guess a precise
 * position, we scroll the editor's scroll container *proportionally*: line N of
 * a T-line document scrolls roughly `(N - 1) / T` of the way down. That lands
 * the referenced region near the viewport without claiming pixel accuracy, and
 * degrades to "stay at the top" whenever the inputs make any jump pointless —
 * no/first line, a single-line document, or nothing scrollable yet (e.g. the
 * jsdom test environment, where layout heights are 0).
 */
export interface BestEffortScrollInput {
    /** 1-based source line the clicked link referenced, if any. */
    line?: number | null;
    /** Total number of lines in the loaded markdown. */
    totalLines: number;
    /** Scrollable content height of the editor container, in px. */
    scrollHeight: number;
    /** Visible height of the editor container, in px. */
    clientHeight: number;
}

/**
 * Compute the `scrollTop` (px) for a best-effort jump to `line`. Returns `0`
 * (open at the top) whenever a meaningful jump is not feasible.
 */
export function computeBestEffortScrollTop({
    line,
    totalLines,
    scrollHeight,
    clientHeight,
}: BestEffortScrollInput): number {
    if (!line || !Number.isFinite(line) || line <= 1) return 0;
    if (!Number.isFinite(totalLines) || totalLines <= 1) return 0;
    const maxScroll = scrollHeight - clientHeight;
    if (!Number.isFinite(maxScroll) || maxScroll <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (line - 1) / totalLines));
    return Math.round(ratio * maxScroll);
}
