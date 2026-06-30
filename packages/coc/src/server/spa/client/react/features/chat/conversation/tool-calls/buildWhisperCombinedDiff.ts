/**
 * buildWhisperCombinedDiff — concatenates the per-file whisper diffs for a whole
 * whisper group into one unified diff covering every reconstructable file (AC-01).
 *
 * The combined whisper diff panel shows the entire change across all files in a
 * whisper group in one scroll. This builder is the synchronous, network-free
 * source for that view: it replays the group's already-captured tool calls
 * through the existing `buildWhisperFileDiff` once per file — in popover (group)
 * order — and concatenates each reconstructable file's `diff --git a/… b/…`
 * section into a single unified diff string.
 *
 * Files that cannot contribute a diff body are NOT reconstructed here; they are
 * reported so the panel can list them separately ("not shown"):
 *   - deleted files — a later shell command removed them, and no reconstructed
 *     deletion diff is available (deletions are out of scope for the combined view).
 *   - non-reconstructable files — Codex-style structured changes that carry no
 *     line content, so `buildWhisperFileDiff` returns `null`.
 *
 * This mirrors the single-file path's decisions but drops its commit/network
 * fallback (that stays single-file only), so the combined view opens instantly.
 */
import { buildWhisperFileDiff, type WhisperDiffToolCall } from './buildWhisperFileDiff';
import type { FileEdit } from './toolGroupUtils';

/** One reconstructed file section: the file summary plus its `diff --git` block. */
export interface CombinedWhisperDiffSection {
    file: FileEdit;
    /** This file's reconstructed unified diff (a single `diff --git` section). */
    diff: string;
}

export interface CombinedWhisperDiff {
    /**
     * One concatenated unified diff — a `diff --git a/… b/…` section per
     * reconstructable file, in group order. Empty string when no file in the
     * group has a reconstructable diff (the panel shows its no-diff message).
     */
    diffText: string;
    /**
     * Per-file reconstructed sections, in group order. Lets the panel render a
     * filename divider before each file's section without re-running the builder.
     */
    sections: CombinedWhisperDiffSection[];
    /** Deleted files (no diff body) — surfaced in the "not shown" list, group order. */
    deletedFiles: FileEdit[];
    /**
     * Non-deleted files with no reconstructable diff (Codex structured changes
     * with no line content) — also surfaced in the "not shown" list, group order.
     */
    nonReconstructableFiles: FileEdit[];
}

/**
 * Build the combined whisper diff for a group from its captured tool calls and
 * its ordered `fileEdits` list (popover / group order).
 */
export function buildWhisperCombinedDiff(
    toolCalls: WhisperDiffToolCall[],
    fileEdits: FileEdit[],
): CombinedWhisperDiff {
    const sections: CombinedWhisperDiffSection[] = [];
    const deletedFiles: FileEdit[] = [];
    const nonReconstructableFiles: FileEdit[] = [];

    for (const file of fileEdits) {
        // Deleted files contribute no diff body — no reconstructed deletion diff
        // is available, so surface them in the "not shown" list instead.
        if (file.isDeleted) {
            deletedFiles.push(file);
            continue;
        }
        const diff = buildWhisperFileDiff(toolCalls, file.path);
        if (diff) {
            sections.push({ file, diff });
        } else {
            // No reconstructable diff (e.g. Codex structured changes with no line
            // content). The single-file path would fall back to a commit diff, but
            // the combined path stays synchronous, so list it as "not shown".
            nonReconstructableFiles.push(file);
        }
    }

    return {
        diffText: sections.map(s => s.diff).join('\n'),
        sections,
        deletedFiles,
        nonReconstructableFiles,
    };
}
