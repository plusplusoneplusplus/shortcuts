/**
 * Pure utility functions for diff rendering.
 * Shared between webview scripts and extension-side code (testable without DOM).
 */

/**
 * Build a hunk header text string from line number info.
 * Used when detecting non-contiguous line number gaps in diff rendering.
 */
export function buildHunkText(
    prevOldLine: number | null, prevNewLine: number | null,
    nextOldLine: number | null, nextNewLine: number | null
): string {
    const oldStart = nextOldLine ?? (prevOldLine ? prevOldLine + 1 : 1);
    const newStart = nextNewLine ?? (prevNewLine ? prevNewLine + 1 : 1);
    return `@@ -${oldStart} +${newStart} @@`;
}

/**
 * Detect whether there is a line number gap between consecutive aligned lines.
 * A gap indicates a hunk boundary where a hunk header should be inserted.
 */
export function hasLineNumberGap(
    prevOldLineNum: number | null, prevNewLineNum: number | null,
    currentOldLineNum: number | null, currentNewLineNum: number | null
): boolean {
    const oldGap = prevOldLineNum !== null && currentOldLineNum !== null
        && currentOldLineNum > prevOldLineNum + 1;
    const newGap = prevNewLineNum !== null && currentNewLineNum !== null
        && currentNewLineNum > prevNewLineNum + 1;
    return oldGap || newGap;
}
