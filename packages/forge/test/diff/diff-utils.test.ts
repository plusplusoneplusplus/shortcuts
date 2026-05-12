/**
 * Tests for diff-utils — shared diff parsing utilities.
 */

import { describe, it, expect } from 'vitest';
import {
    makeDiffContent,
    computeSummary,
    truncateDiffContent,
    splitIntoChunks,
    extractBPath,
    extractAPath,
    inferStatusFromDiffChunk,
    countAdditionsDeletions,
    parseFullDiff,
    splitDiffByFile,
} from '../../src/diff/diff-utils';
import type { DiffFileEntry } from '../../src/diff/types';

// ── Test data ────────────────────────────────────────────────

const FILE_DIFF_FOO = `diff --git a/foo.ts b/foo.ts
index abc1234..def5678 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3
`;

const FILE_DIFF_BAR = `diff --git a/bar.ts b/bar.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/bar.ts
@@ -0,0 +1,2 @@
+new line 1
+new line 2
`;

const FILE_DIFF_DELETED = `diff --git a/old.ts b/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-gone1
-gone2
-gone3
`;

const FILE_DIFF_RENAMED = `diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
`;

const FILE_DIFF_BINARY = `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..abc1234
Binary files /dev/null and b/image.png differ
`;

const FULL_DIFF = [FILE_DIFF_FOO, FILE_DIFF_BAR].join('');

// ── makeDiffContent ──────────────────────────────────────────

describe('makeDiffContent', () => {
    it('wraps raw diff string', () => {
        const result = makeDiffContent('line1\nline2\n');
        expect(result.raw).toBe('line1\nline2\n');
        expect(result.truncated).toBe(false);
        expect(result.totalLines).toBe(3);
    });

    it('handles empty string', () => {
        const result = makeDiffContent('');
        expect(result.raw).toBe('');
        expect(result.totalLines).toBe(0);
    });
});

// ── computeSummary ───────────────────────────────────────────

describe('computeSummary', () => {
    it('sums additions and deletions', () => {
        const files: DiffFileEntry[] = [
            { path: 'a.ts', status: 'modified', additions: 5, deletions: 2 },
            { path: 'b.ts', status: 'added', additions: 10, deletions: 0 },
        ];
        const summary = computeSummary(files);
        expect(summary).toEqual({ filesChanged: 2, additions: 15, deletions: 2 });
    });

    it('handles missing stats', () => {
        const files: DiffFileEntry[] = [
            { path: 'a.ts', status: 'modified' },
        ];
        const summary = computeSummary(files);
        expect(summary).toEqual({ filesChanged: 1, additions: 0, deletions: 0 });
    });

    it('returns zero for empty list', () => {
        expect(computeSummary([])).toEqual({ filesChanged: 0, additions: 0, deletions: 0 });
    });
});

// ── splitIntoChunks ──────────────────────────────────────────

describe('splitIntoChunks', () => {
    it('splits on diff --git headers', () => {
        const chunks = splitIntoChunks(FULL_DIFF);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toContain('foo.ts');
        expect(chunks[1]).toContain('bar.ts');
    });

    it('returns empty array for empty input', () => {
        expect(splitIntoChunks('')).toEqual([]);
        expect(splitIntoChunks('  \n  ')).toEqual([]);
    });
});

// ── extractBPath / extractAPath ──────────────────────────────

describe('extractBPath', () => {
    it('extracts b/ path', () => {
        expect(extractBPath(FILE_DIFF_FOO)).toBe('foo.ts');
    });

    it('returns undefined for malformed header', () => {
        expect(extractBPath('no header here')).toBeUndefined();
    });
});

describe('extractAPath', () => {
    it('extracts a/ path', () => {
        expect(extractAPath(FILE_DIFF_FOO)).toBe('foo.ts');
    });

    it('extracts a/ path for renames', () => {
        expect(extractAPath(FILE_DIFF_RENAMED)).toBe('old-name.ts');
    });
});

// ── inferStatusFromDiffChunk ─────────────────────────────────

describe('inferStatusFromDiffChunk', () => {
    it('detects added file', () => {
        expect(inferStatusFromDiffChunk(FILE_DIFF_BAR)).toBe('added');
    });

    it('detects deleted file', () => {
        expect(inferStatusFromDiffChunk(FILE_DIFF_DELETED)).toBe('deleted');
    });

    it('detects renamed file', () => {
        expect(inferStatusFromDiffChunk(FILE_DIFF_RENAMED)).toBe('renamed');
    });

    it('defaults to modified', () => {
        expect(inferStatusFromDiffChunk(FILE_DIFF_FOO)).toBe('modified');
    });
});

// ── countAdditionsDeletions ──────────────────────────────────

describe('countAdditionsDeletions', () => {
    it('counts additions and deletions', () => {
        const result = countAdditionsDeletions(FILE_DIFF_FOO);
        expect(result.additions).toBe(1);
        expect(result.deletions).toBe(0);
    });

    it('counts deletions for deleted file', () => {
        const result = countAdditionsDeletions(FILE_DIFF_DELETED);
        expect(result.additions).toBe(0);
        expect(result.deletions).toBe(3);
    });

    it('ignores +++ and --- headers', () => {
        const result = countAdditionsDeletions(FILE_DIFF_BAR);
        // +new line 1, +new line 2 (not +++ b/bar.ts)
        expect(result.additions).toBe(2);
        expect(result.deletions).toBe(0);
    });
});

// ── parseFullDiff ────────────────────────────────────────────

describe('parseFullDiff', () => {
    it('parses multi-file diff into entries and content map', () => {
        const { files, contentByPath } = parseFullDiff(FULL_DIFF);
        expect(files).toHaveLength(2);
        expect(contentByPath.size).toBe(2);
    });

    it('sorts files by path', () => {
        const { files } = parseFullDiff(FULL_DIFF);
        expect(files[0].path).toBe('bar.ts');
        expect(files[1].path).toBe('foo.ts');
    });

    it('detects rename with originalPath', () => {
        const { files } = parseFullDiff(FILE_DIFF_RENAMED);
        expect(files[0].status).toBe('renamed');
        expect(files[0].originalPath).toBe('old-name.ts');
    });

    it('detects binary file', () => {
        const { files } = parseFullDiff(FILE_DIFF_BINARY);
        expect(files[0].isBinary).toBe(true);
    });

    it('handles empty input', () => {
        const { files, contentByPath } = parseFullDiff('');
        expect(files).toEqual([]);
        expect(contentByPath.size).toBe(0);
    });
});

// ── splitDiffByFile ──────────────────────────────────────────

describe('splitDiffByFile', () => {
    it('maps diff chunks to known file entries', () => {
        const files: DiffFileEntry[] = [
            { path: 'foo.ts', status: 'modified' },
            { path: 'bar.ts', status: 'added' },
        ];
        const target = new Map();
        splitDiffByFile(FULL_DIFF, files, target);

        expect(target.size).toBe(2);
        expect(target.get('foo.ts')?.raw).toContain('foo.ts');
        expect(target.get('bar.ts')?.raw).toContain('bar.ts');
    });

    it('stores unknown files by bPath', () => {
        const files: DiffFileEntry[] = []; // empty file list
        const target = new Map();
        splitDiffByFile(FILE_DIFF_FOO, files, target);

        expect(target.size).toBe(1);
        expect(target.has('foo.ts')).toBe(true);
    });

    it('handles empty diff', () => {
        const target = new Map();
        splitDiffByFile('', [], target);
        expect(target.size).toBe(0);
    });
});

// ── truncateDiffContent ──────────────────────────────────────

describe('truncateDiffContent', () => {
    const multiLineDiff = makeDiffContent('line1\nline2\nline3\nline4\nline5');

    it('returns original when within maxLines limit', () => {
        const result = truncateDiffContent(multiLineDiff, 10);
        expect(result).toBe(multiLineDiff); // same reference
        expect(result.truncated).toBe(false);
    });

    it('returns original when exactly at maxLines', () => {
        const result = truncateDiffContent(multiLineDiff, 5);
        expect(result).toBe(multiLineDiff);
    });

    it('truncates when exceeding maxLines', () => {
        const result = truncateDiffContent(multiLineDiff, 3);
        expect(result.raw).toBe('line1\nline2\nline3');
        expect(result.truncated).toBe(true);
        expect(result.totalLines).toBe(multiLineDiff.totalLines);
    });

    it('truncates to 1 line', () => {
        const result = truncateDiffContent(multiLineDiff, 1);
        expect(result.raw).toBe('line1');
        expect(result.truncated).toBe(true);
    });

    it('returns empty string when maxLines is 0', () => {
        const result = truncateDiffContent(multiLineDiff, 0);
        expect(result.raw).toBe('');
        expect(result.truncated).toBe(true);
        expect(result.totalLines).toBe(multiLineDiff.totalLines);
    });

    it('returns empty for negative maxLines', () => {
        const result = truncateDiffContent(multiLineDiff, -1);
        expect(result.raw).toBe('');
        expect(result.truncated).toBe(true);
    });

    it('handles empty content', () => {
        const empty = makeDiffContent('');
        const result = truncateDiffContent(empty, 5);
        expect(result).toBe(empty);
    });

    it('preserves totalLines from original', () => {
        const result = truncateDiffContent(multiLineDiff, 2);
        expect(result.totalLines).toBe(5);
        expect(result.raw.split('\n').length).toBe(2);
    });
});
