/**
 * Shared utilities for diff providers.
 *
 * Extracted from git-diff-provider and pr-diff-provider to eliminate
 * duplication of `makeDiffContent`, `computeSummary`, and diff-splitting logic.
 */

import type { GitChangeStatus } from '../git/types';
import type { DiffContent, DiffFileEntry, DiffSummary } from './types';

// ── DiffContent construction ─────────────────────────────────

/**
 * Wrap a raw diff string into a `DiffContent` object.
 */
export function makeDiffContent(raw: string): DiffContent {
    const totalLines = raw ? raw.split('\n').length : 0;
    return { raw, truncated: false, totalLines };
}

// ── Truncation ───────────────────────────────────────────────

/**
 * Truncate a `DiffContent` to at most `maxLines` lines.
 * Returns the original object unchanged if the diff fits within the limit.
 */
export function truncateDiffContent(content: DiffContent, maxLines: number): DiffContent {
    if (maxLines <= 0) return { raw: '', truncated: true, totalLines: content.totalLines };
    const lines = content.raw.split('\n');
    if (lines.length <= maxLines) return content;
    return {
        raw: lines.slice(0, maxLines).join('\n'),
        truncated: true,
        totalLines: content.totalLines,
    };
}

// ── Summary computation ──────────────────────────────────────

/**
 * Compute aggregate `DiffSummary` from a list of file entries.
 */
export function computeSummary(files: DiffFileEntry[]): DiffSummary {
    let additions = 0;
    let deletions = 0;
    for (const f of files) {
        additions += f.additions ?? 0;
        deletions += f.deletions ?? 0;
    }
    return { filesChanged: files.length, additions, deletions };
}

// ── Diff chunk parsing ───────────────────────────────────────

/**
 * Split a combined unified diff string on `diff --git` headers.
 * Skips empty chunks.
 */
export function splitIntoChunks(fullDiff: string): string[] {
    if (!fullDiff.trim()) return [];
    return fullDiff.split(/(?=^diff --git )/m).filter(c => c.trim());
}

/** Extract the `b/` path from a `diff --git a/… b/…` header. */
export function extractBPath(chunk: string): string | undefined {
    const match = chunk.match(/^diff --git a\/.+ b\/(.+)$/m);
    return match?.[1];
}

/** Extract the `a/` path from a `diff --git a/… b/…` header (for renames). */
export function extractAPath(chunk: string): string | undefined {
    const match = chunk.match(/^diff --git a\/(.+?) b\//m);
    return match?.[1];
}

/**
 * Infer `GitChangeStatus` from the diff header for a file chunk.
 *
 * Uses heuristics:
 * - `--- /dev/null`  → added
 * - `+++ /dev/null`  → deleted
 * - `rename from …`  → renamed
 * - `copy from …`    → copied
 * - otherwise        → modified
 */
export function inferStatusFromDiffChunk(chunk: string): GitChangeStatus {
    if (/^--- \/dev\/null$/m.test(chunk)) return 'added';
    if (/^\+\+\+ \/dev\/null$/m.test(chunk)) return 'deleted';
    if (/^rename from /m.test(chunk)) return 'renamed';
    if (/^copy from /m.test(chunk)) return 'copied';
    return 'modified';
}

/**
 * Count additions/deletions from unified diff hunk lines.
 */
export function countAdditionsDeletions(chunk: string): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
    return { additions, deletions };
}

// ── Full diff parsing ────────────────────────────────────────

/**
 * Parse a full unified diff string into per-file entries and content map.
 *
 * This is the primary function for remote diff providers that receive
 * the entire diff as a single string and need to split it into per-file data.
 */
export function parseFullDiff(fullDiff: string): {
    files: DiffFileEntry[];
    contentByPath: Map<string, DiffContent>;
} {
    const files: DiffFileEntry[] = [];
    const contentByPath = new Map<string, DiffContent>();

    const chunks = splitIntoChunks(fullDiff);

    for (const chunk of chunks) {
        const bPath = extractBPath(chunk);
        if (!bPath) continue;

        const status = inferStatusFromDiffChunk(chunk);
        const { additions, deletions } = countAdditionsDeletions(chunk);

        const entry: DiffFileEntry = {
            path: bPath,
            status,
            additions,
            deletions,
        };

        if (status === 'renamed' || status === 'copied') {
            const aPath = extractAPath(chunk);
            if (aPath && aPath !== bPath) {
                entry.originalPath = aPath;
            }
        }

        // Detect binary: no hunk lines at all
        if (additions === 0 && deletions === 0 && !/^@@/m.test(chunk)) {
            entry.isBinary = true;
        }

        files.push(entry);
        contentByPath.set(bPath, makeDiffContent(chunk));
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, contentByPath };
}

/**
 * Split a combined unified diff into per-file chunks and match against
 * a known file list. Used by git-based providers where the file list
 * is already known from `--name-status`.
 */
export function splitDiffByFile(
    fullDiff: string,
    files: DiffFileEntry[],
    target: Map<string, DiffContent>,
): void {
    const chunks = splitIntoChunks(fullDiff);

    for (const chunk of chunks) {
        const bPath = extractBPath(chunk);
        if (!bPath) continue;

        const file = files.find(f => f.path === bPath);
        if (file) {
            target.set(file.path, makeDiffContent(chunk));
        } else {
            target.set(bPath, makeDiffContent(chunk));
        }
    }
}
