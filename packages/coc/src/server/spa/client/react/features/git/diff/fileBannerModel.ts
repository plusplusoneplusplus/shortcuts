/**
 * fileBannerModel — pure parse model for the per-file banner shown in the
 * continuous (whole-commit) diff view.
 *
 * A raw git diff precedes every file with a preamble that is pure noise for a
 * reviewer:
 *
 *     diff --git a/src/app-menu.ts b/src/app-menu.ts
 *     index 2793a9ad6..8cd4f108a 100644
 *     --- a/src/app-menu.ts
 *     +++ b/src/app-menu.ts
 *
 * The viewers replace that whole block with a single banner row. The rule is
 * positional, not per-line-prefix: everything from the `diff --git` line up to
 * (not including) the first `@@` hunk header belongs to the preamble. That
 * covers the four lines above plus `new file mode`, `deleted file mode`,
 * `old mode`/`new mode`, `similarity index`, `rename from`/`rename to`,
 * `copy from`/`copy to`, and `--- /dev/null` / `+++ /dev/null`. A binary file
 * section has no `@@` at all — its preamble runs to the start of the next file
 * (or the end of the diff) and the banner renders with no hunks under it.
 *
 * Everything here is pure and DOM-free so it can be unit-tested exhaustively and
 * shared by UnifiedDiffViewer and SideBySideDiffViewer.
 */

import { extractFilePathFromDiffHeader } from './UnifiedDiffViewer';

/** Change status derived from the git preamble, driving the banner badge. */
export type FileBannerStatus = 'modified' | 'new' | 'deleted' | 'renamed';

/** One file section of a multi-file diff, as summarized by its banner row. */
export interface FileBanner {
    /**
     * Diff-line index of the `diff --git` line. This row is *replaced* by the
     * banner, so line indices of every other row are unchanged — find-match
     * ranges (`matchRangesByLine`) keep lining up with no offset math.
     */
    startIdx: number;
    /**
     * Exclusive end of the suppressed preamble: the index of the first `@@`
     * hunk header of this file, or the start of the next file / end of the diff
     * when the file has no hunks (binary).
     */
    preambleEndIdx: number;
    /** Current path (the `b/` side), kept whole so the banner stays greppable. */
    path: string;
    /** Previous path, set only for renames/copies. */
    oldPath?: string;
    status: FileBannerStatus;
    /** Added lines in this file's hunks. */
    additions: number;
    /** Removed lines in this file's hunks. */
    deletions: number;
    /** True for a `Binary files … differ` section (no hunks follow). */
    binary: boolean;
    /** Raw `index <sha>..<sha>[ <mode>]` value — dropped from the row, kept for the details tooltip. */
    indexLine?: string;
    /** File mode from `new file mode` / `deleted file mode` / `new mode`. */
    mode?: string;
    /** Similarity percentage from `similarity index NN%`, for renames/copies. */
    similarity?: number;
}

/** Split a path into its directory prefix (with trailing slash) and basename. */
export function splitPath(path: string): { dir: string; base: string } {
    const slash = path.lastIndexOf('/');
    if (slash === -1) return { dir: '', base: path };
    return { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) };
}

/** Human label for a banner status badge. */
export const BANNER_STATUS_LABELS: Record<FileBannerStatus, string> = {
    modified: 'modified',
    new: 'new file',
    deleted: 'deleted',
    renamed: 'renamed',
};

/** Badge color classes per status (light + dark). */
export const BANNER_STATUS_CLASSES: Record<FileBannerStatus, string> = {
    modified: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    new: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    deleted: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
    renamed: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
};

/** Strip a leading `a/` or `b/` prefix from a git preamble path. */
function stripPrefix(p: string): string {
    return p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p;
}

/**
 * Parse every file section of a unified diff into a `FileBanner`.
 *
 * `lines` must be the same array the viewers render (`diff.split('\n')`) so the
 * returned indices address rows directly.
 */
export function parseFileBanners(lines: string[]): FileBanner[] {
    // Locate each file section first, so a section's preamble can be bounded by
    // the *next* `diff --git` even when it contains no `@@` (binary files).
    const starts: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('diff --git ')) starts.push(i);
    }

    return starts.map((startIdx, n) => {
        const sectionEnd = n + 1 < starts.length ? starts[n + 1] : lines.length;

        let preambleEndIdx = sectionEnd;
        for (let i = startIdx + 1; i < sectionEnd; i++) {
            if (lines[i].startsWith('@@')) { preambleEndIdx = i; break; }
        }

        const banner: FileBanner = {
            startIdx,
            preambleEndIdx,
            path: extractFilePathFromDiffHeader(lines[startIdx]) ?? '',
            status: 'modified',
            additions: 0,
            deletions: 0,
            binary: false,
        };

        // ── Preamble: status, paths, and the details we hide from the row ──
        for (let i = startIdx + 1; i < preambleEndIdx; i++) {
            const line = lines[i];
            if (line.startsWith('index ')) {
                banner.indexLine = line.slice('index '.length);
            } else if (line.startsWith('new file mode ')) {
                banner.status = 'new';
                banner.mode = line.slice('new file mode '.length).trim();
            } else if (line.startsWith('deleted file mode ')) {
                banner.status = 'deleted';
                banner.mode = line.slice('deleted file mode '.length).trim();
            } else if (line.startsWith('new mode ')) {
                banner.mode = line.slice('new mode '.length).trim();
            } else if (line.startsWith('similarity index ')) {
                const pct = parseInt(line.slice('similarity index '.length), 10);
                if (!Number.isNaN(pct)) banner.similarity = pct;
            } else if (line.startsWith('rename from ')) {
                banner.status = 'renamed';
                banner.oldPath = line.slice('rename from '.length);
            } else if (line.startsWith('rename to ')) {
                banner.status = 'renamed';
                banner.path = line.slice('rename to '.length);
            } else if (line.startsWith('copy from ')) {
                banner.status = 'renamed';
                banner.oldPath = line.slice('copy from '.length);
            } else if (line.startsWith('copy to ')) {
                banner.status = 'renamed';
                banner.path = line.slice('copy to '.length);
            } else if (line.startsWith('--- ')) {
                // `--- /dev/null` means the file did not exist before → added.
                const from = line.slice(4).trim();
                if (from === '/dev/null') banner.status = 'new';
            } else if (line.startsWith('+++ ')) {
                const to = line.slice(4).trim();
                if (to === '/dev/null') banner.status = 'deleted';
                else if (banner.status !== 'renamed') banner.path = stripPrefix(to);
            } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
                banner.binary = true;
            }
        }

        // ── Hunk bodies: added/removed counts. Counting starts after the first
        // `@@` so preamble `---`/`+++` lines can never be miscounted, and a code
        // line whose content itself starts with `--`/`++` is counted correctly.
        for (let i = preambleEndIdx; i < sectionEnd; i++) {
            const line = lines[i];
            if (line.startsWith('@@')) continue;
            if (line.startsWith('+')) banner.additions++;
            else if (line.startsWith('-')) banner.deletions++;
            else if (line.startsWith('Binary files ')) banner.binary = true;
        }

        return banner;
    });
}

/**
 * Index the banners for O(1) row rendering.
 *
 * `bannerByStart` maps the `diff --git` row index → its banner (that row renders
 * the banner). `suppressed` holds every *other* preamble row index, which the
 * viewers skip. Row indices are never renumbered, so downstream line-index
 * consumers (find match ranges, comment anchors, hunk ranges) are unaffected.
 */
export function buildBannerIndex(banners: FileBanner[]): {
    bannerByStart: Map<number, FileBanner>;
    suppressed: Set<number>;
} {
    const bannerByStart = new Map<number, FileBanner>();
    const suppressed = new Set<number>();
    for (const b of banners) {
        bannerByStart.set(b.startIdx, b);
        for (let i = b.startIdx + 1; i < b.preambleEndIdx; i++) suppressed.add(i);
    }
    return { bannerByStart, suppressed };
}

/**
 * Every preamble row index, *including* the `diff --git` line.
 *
 * Used by surfaces whose own chrome already shows the file name (the
 * single-file diff panel): the whole block is dropped rather than replaced by a
 * banner row. Unlike a per-line-prefix filter this also covers `old mode`,
 * `similarity index`, and `Binary files … differ`, which git does not prefix.
 */
export function buildPreambleIndex(banners: FileBanner[]): Set<number> {
    const hidden = new Set<number>();
    for (const b of banners) {
        for (let i = b.startIdx; i < b.preambleEndIdx; i++) hidden.add(i);
    }
    return hidden;
}

/**
 * The banner owning a given diff-line index — i.e. the last file section that
 * starts at or before it. Drives the pinned banner in the windowed row list,
 * where the in-flow sticky row is not in the DOM.
 */
export function bannerForLineIndex(banners: FileBanner[], lineIndex: number): FileBanner | undefined {
    let found: FileBanner | undefined;
    for (const b of banners) {
        if (b.startIdx > lineIndex) break;
        found = b;
    }
    return found;
}

/**
 * The banner to dock at the top edge of the scrollport for a given topmost row,
 * plus whether an overlay copy is needed to show it.
 *
 * In the windowed row list the `diff --git` row still renders a banner in flow,
 * so an overlay must be rendered *iff* that in-flow row has already scrolled
 * above the top edge — otherwise the same file gets two banners (the bug this
 * exists to prevent) and at scroll top the first file shows a duplicate.
 *
 * `entries` must be ascending by `rowIndex`. The index space is viewer-specific
 * — unified passes diff-line indices, split passes `sxsLines` row indices —
 * hence the generic index rather than reusing {@link bannerForLineIndex}.
 */
export function pinnedBannerForTopRow<T>(
    entries: { rowIndex: number; banner: T }[],
    topRowIndex: number,
): { banner: T; overlay: boolean } | undefined {
    let found: { rowIndex: number; banner: T } | undefined;
    for (const e of entries) {
        if (e.rowIndex > topRowIndex) break;
        found = e;
    }
    if (!found) return undefined;
    return { banner: found.banner, overlay: found.rowIndex < topRowIndex };
}

/** Tooltip text carrying the blob hashes / mode / similarity dropped from the row. */
export function bannerDetailsText(banner: FileBanner): string {
    const parts: string[] = [];
    if (banner.indexLine) parts.push(`index ${banner.indexLine}`);
    if (banner.mode) parts.push(`mode ${banner.mode}`);
    if (banner.similarity !== undefined) parts.push(`similarity ${banner.similarity}%`);
    if (banner.oldPath) parts.push(`from ${banner.oldPath}`);
    if (banner.binary) parts.push('binary');
    return parts.join('\n');
}
