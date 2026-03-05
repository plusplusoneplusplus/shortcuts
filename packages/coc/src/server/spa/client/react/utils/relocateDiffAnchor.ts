/**
 * relocateDiffAnchor — pure utility for re-matching a comment anchor
 * against a new DiffLine[] after the underlying diff changes.
 *
 * Three strategies are tried in order:
 *   1. Exact hash match (textHash)
 *   2. Substring match (selectedText)
 *   3. Context match (contextBefore on previous line AND contextAfter on next line)
 *
 * Returns the new 0-based line index, or null when no strategy succeeds
 * (meaning the comment should be marked orphaned).
 * Returns the existing diffLineStart unchanged when the comment has no anchor.
 */

import type { DiffLine } from '../repos/UnifiedDiffViewer';
import type { DiffComment } from '../../diff-comment-types';

/** djb2 hash — mirrors pipeline-core's hashText implementation. */
function hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Re-locate a comment's anchor against a new set of diff lines.
 *
 * @param comment  - The comment whose anchor is being evaluated.
 * @param newLines - The new DiffLine[] from the updated diff.
 * @returns The new 0-based index into newLines, or null if not found.
 */
export function relocateDiffAnchor(
    comment: DiffComment,
    newLines: DiffLine[],
): number | null {
    const anchor = comment.anchor;
    if (!anchor) return comment.selection.diffLineStart; // unchanged

    // Strategy 1 – exact hash match
    const byHash = newLines.findIndex(
        (l) => hashText(l.content) === anchor.textHash,
    );
    if (byHash !== -1) return byHash;

    // Strategy 2 – substring match (first occurrence of selectedText)
    if (anchor.selectedText) {
        const byText = newLines.findIndex((l) =>
            l.content.includes(anchor.selectedText),
        );
        if (byText !== -1) return byText;
    }

    // Strategy 3 – context match (contextBefore on preceding line AND contextAfter on following line)
    if (anchor.contextBefore || anchor.contextAfter) {
        for (let i = 1; i < newLines.length - 1; i++) {
            const prevMatch =
                !anchor.contextBefore ||
                newLines[i - 1].content.includes(anchor.contextBefore);
            const nextMatch =
                !anchor.contextAfter ||
                newLines[i + 1].content.includes(anchor.contextAfter);
            if (prevMatch && nextMatch) return i;
        }
    }

    // No match → orphaned
    return null;
}
