/**
 * Tests for the unified-diff parser used by the PR detail page to
 * surface real file changes from the `/diff` REST endpoint.
 */

import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../../../../../src/server/spa/client/react/features/pull-requests/unified-diff-parser';

describe('parseUnifiedDiff — empty input', () => {
    it('returns an empty result for null / undefined / empty / whitespace', () => {
        for (const input of [null, undefined, '', '   \n   ']) {
            const result = parseUnifiedDiff(input as string);
            expect(result.files).toEqual([]);
            expect(result.fileCount).toBe(0);
            expect(result.totalAdditions).toBe(0);
            expect(result.totalDeletions).toBe(0);
        }
    });
});

describe('parseUnifiedDiff — modified file', () => {
    const diff = [
        'diff --git a/src/foo.ts b/src/foo.ts',
        'index 1234567..abcdef0 100644',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -10,3 +10,4 @@',
        ' context one',
        '-removed one',
        '+added one',
        '+added two',
        ' context two',
        '',
    ].join('\n');

    it('parses path, status, and counts', () => {
        const { files, totalAdditions, totalDeletions, fileCount } = parseUnifiedDiff(diff);
        expect(fileCount).toBe(1);
        expect(files[0].path).toBe('src/foo.ts');
        expect(files[0].oldPath).toBeUndefined();
        expect(files[0].status).toBe('modified');
        expect(files[0].additions).toBe(2);
        expect(files[0].deletions).toBe(1);
        expect(files[0].isBinary).toBe(false);
        expect(totalAdditions).toBe(2);
        expect(totalDeletions).toBe(1);
    });

    it('captures hunk header and line numbers on both sides', () => {
        const file = parseUnifiedDiff(diff).files[0];
        expect(file.lines[0].kind).toBe('hunk');
        expect(file.lines[0].text).toContain('@@ -10,3 +10,4 @@');

        const ctxOne = file.lines[1];
        expect(ctxOne).toMatchObject({ kind: 'ctx', text: 'context one', oldLineNo: 10, newLineNo: 10 });

        const removed = file.lines[2];
        expect(removed).toMatchObject({ kind: 'del', text: 'removed one', oldLineNo: 11 });
        expect(removed.newLineNo).toBeUndefined();

        const added = file.lines[3];
        expect(added).toMatchObject({ kind: 'add', text: 'added one', newLineNo: 11 });
        expect(added.oldLineNo).toBeUndefined();

        const ctxTwo = file.lines.find(l => l.text === 'context two')!;
        expect(ctxTwo.oldLineNo).toBe(12);
        expect(ctxTwo.newLineNo).toBe(13);
    });
});

describe('parseUnifiedDiff — added and deleted files', () => {
    it('recognizes new files via `new file mode`', () => {
        const diff = [
            'diff --git a/new.txt b/new.txt',
            'new file mode 100644',
            'index 0000000..abcdef0',
            '--- /dev/null',
            '+++ b/new.txt',
            '@@ -0,0 +1,2 @@',
            '+line one',
            '+line two',
            '',
        ].join('\n');
        const file = parseUnifiedDiff(diff).files[0];
        expect(file.path).toBe('new.txt');
        expect(file.status).toBe('added');
        expect(file.additions).toBe(2);
        expect(file.deletions).toBe(0);
    });

    it('recognizes deleted files via `deleted file mode`', () => {
        const diff = [
            'diff --git a/old.txt b/old.txt',
            'deleted file mode 100644',
            'index abcdef0..0000000',
            '--- a/old.txt',
            '+++ /dev/null',
            '@@ -1,2 +0,0 @@',
            '-line one',
            '-line two',
            '',
        ].join('\n');
        const file = parseUnifiedDiff(diff).files[0];
        expect(file.path).toBe('old.txt');
        expect(file.status).toBe('deleted');
        expect(file.additions).toBe(0);
        expect(file.deletions).toBe(2);
    });
});

describe('parseUnifiedDiff — renames and binary', () => {
    it('parses renames with both old and new paths', () => {
        const diff = [
            'diff --git a/old/path.ts b/new/path.ts',
            'similarity index 95%',
            'rename from old/path.ts',
            'rename to new/path.ts',
            'index 1234..abcd 100644',
            '--- a/old/path.ts',
            '+++ b/new/path.ts',
            '@@ -1,1 +1,1 @@',
            '-keep',
            '+keep updated',
            '',
        ].join('\n');
        const file = parseUnifiedDiff(diff).files[0];
        expect(file.status).toBe('renamed');
        expect(file.oldPath).toBe('old/path.ts');
        expect(file.path).toBe('new/path.ts');
        expect(file.additions).toBe(1);
        expect(file.deletions).toBe(1);
    });

    it('marks binary files via the `Binary files` notice', () => {
        const diff = [
            'diff --git a/logo.png b/logo.png',
            'index 1234..abcd 100644',
            'Binary files a/logo.png and b/logo.png differ',
            '',
        ].join('\n');
        const file = parseUnifiedDiff(diff).files[0];
        expect(file.path).toBe('logo.png');
        expect(file.isBinary).toBe(true);
        expect(file.additions).toBe(0);
        expect(file.deletions).toBe(0);
        expect(file.lines).toHaveLength(0);
    });
});

describe('parseUnifiedDiff — multi-file totals', () => {
    it('aggregates totals across multiple files', () => {
        const diff = [
            'diff --git a/a.txt b/a.txt',
            'index 1..2 100644',
            '--- a/a.txt',
            '+++ b/a.txt',
            '@@ -1,1 +1,2 @@',
            ' shared',
            '+only on a',
            'diff --git a/b.txt b/b.txt',
            'index 3..4 100644',
            '--- a/b.txt',
            '+++ b/b.txt',
            '@@ -1,2 +1,1 @@',
            ' shared',
            '-removed from b',
            '',
        ].join('\n');
        const result = parseUnifiedDiff(diff);
        expect(result.fileCount).toBe(2);
        expect(result.files.map(f => f.path)).toEqual(['a.txt', 'b.txt']);
        expect(result.totalAdditions).toBe(1);
        expect(result.totalDeletions).toBe(1);
    });

    it('ignores `\\ No newline at end of file` trailers', () => {
        const diff = [
            'diff --git a/x b/x',
            'index 1..2 100644',
            '--- a/x',
            '+++ b/x',
            '@@ -1 +1 @@',
            '-old',
            '\\ No newline at end of file',
            '+new',
            '\\ No newline at end of file',
            '',
        ].join('\n');
        const file = parseUnifiedDiff(diff).files[0];
        expect(file.additions).toBe(1);
        expect(file.deletions).toBe(1);
        expect(file.lines.filter(l => l.kind === 'add' || l.kind === 'del')).toHaveLength(2);
    });
});

describe('parseUnifiedDiff — defensive behavior', () => {
    it('does not throw on a malformed hunk header (skips the hunk)', () => {
        const diff = [
            'diff --git a/foo b/foo',
            '--- a/foo',
            '+++ b/foo',
            '@@ broken header @@',
            '+would have been added',
            '',
        ].join('\n');
        expect(() => parseUnifiedDiff(diff)).not.toThrow();
        const file = parseUnifiedDiff(diff).files[0];
        // Lines outside a recognized hunk are skipped, not counted as additions.
        expect(file.additions).toBe(0);
        expect(file.deletions).toBe(0);
    });
});
