/**
 * Tests for parseDiffFileList — extracting FileChange[] from raw unified diff text.
 */

import { describe, it, expect } from 'vitest';
import { parseDiffFileList } from '../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';

describe('parseDiffFileList', () => {
    it('extracts single modified file', () => {
        const diff = [
            'diff --git a/src/auth.ts b/src/auth.ts',
            'index abc1234..def5678 100644',
            '--- a/src/auth.ts',
            '+++ b/src/auth.ts',
            '@@ -1,3 +1,5 @@',
            ' line1',
            '-old line',
            '+new line',
            '+added line',
            ' line3',
        ].join('\n');

        const files = parseDiffFileList(diff);
        expect(files).toEqual([
            { status: 'M', path: 'src/auth.ts', additions: 2, deletions: 1 },
        ]);
    });

    it('detects added file', () => {
        const diff = [
            'diff --git a/new.ts b/new.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/new.ts',
            '@@ -0,0 +1,2 @@',
            '+line1',
            '+line2',
        ].join('\n');

        const files = parseDiffFileList(diff);
        expect(files).toEqual([
            { status: 'A', path: 'new.ts', additions: 2, deletions: 0 },
        ]);
    });

    it('detects deleted file', () => {
        const diff = [
            'diff --git a/old.ts b/old.ts',
            'deleted file mode 100644',
            '--- a/old.ts',
            '+++ /dev/null',
            '@@ -1,3 +0,0 @@',
            '-line1',
            '-line2',
            '-line3',
        ].join('\n');

        const files = parseDiffFileList(diff);
        expect(files).toEqual([
            { status: 'D', path: 'old.ts', additions: 0, deletions: 3 },
        ]);
    });

    it('detects renamed file', () => {
        const diff = [
            'diff --git a/old-name.ts b/new-name.ts',
            'similarity index 90%',
            'rename from old-name.ts',
            'rename to new-name.ts',
            '--- a/old-name.ts',
            '+++ b/new-name.ts',
            '@@ -1,2 +1,2 @@',
            '-old',
            '+new',
        ].join('\n');

        const files = parseDiffFileList(diff);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('R');
        expect(files[0].path).toBe('new-name.ts');
        expect(files[0].oldPath).toBe('old-name.ts');
    });

    it('handles multiple files', () => {
        const diff = [
            'diff --git a/a.ts b/a.ts',
            '--- a/a.ts',
            '+++ b/a.ts',
            '@@ -1,2 +1,3 @@',
            ' keep',
            '+added',
            '',
            'diff --git a/b.ts b/b.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/b.ts',
            '@@ -0,0 +1 @@',
            '+hello',
            '',
            'diff --git a/c.ts b/c.ts',
            'deleted file mode 100644',
            '--- a/c.ts',
            '+++ /dev/null',
            '@@ -1 +0,0 @@',
            '-bye',
        ].join('\n');

        const files = parseDiffFileList(diff);
        expect(files).toHaveLength(3);
        expect(files[0]).toMatchObject({ status: 'M', path: 'a.ts', additions: 1, deletions: 0 });
        expect(files[1]).toMatchObject({ status: 'A', path: 'b.ts', additions: 1 });
        expect(files[2]).toMatchObject({ status: 'D', path: 'c.ts', deletions: 1 });
    });

    it('returns empty array for empty string', () => {
        expect(parseDiffFileList('')).toEqual([]);
    });

    it('returns empty array for non-diff text', () => {
        expect(parseDiffFileList('just some random text\nno diff here')).toEqual([]);
    });

    it('handles file paths with spaces', () => {
        const diff = [
            'diff --git a/path with spaces/file.ts b/path with spaces/file.ts',
            '--- a/path with spaces/file.ts',
            '+++ b/path with spaces/file.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n');

        const files = parseDiffFileList(diff);
        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('path with spaces/file.ts');
    });
});
