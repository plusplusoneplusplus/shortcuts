/**
 * Tests for scrollToFile handle method and data-file-path attributes
 * in UnifiedDiffViewer and SideBySideDiffViewer.
 */

import { describe, it, expect } from 'vitest';
import {
    computeDiffLines,
    computeSideBySideLines,
    extractFilePathFromDiffHeader,
} from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

describe('extractFilePathFromDiffHeader', () => {
    it('extracts file path from standard diff header', () => {
        expect(extractFilePathFromDiffHeader('diff --git a/src/auth.ts b/src/auth.ts')).toBe('src/auth.ts');
    });

    it('extracts path from rename header (uses b/ side)', () => {
        expect(extractFilePathFromDiffHeader('diff --git a/old.ts b/new.ts')).toBe('new.ts');
    });

    it('handles paths with spaces', () => {
        expect(extractFilePathFromDiffHeader('diff --git a/path with spaces/file.ts b/path with spaces/file.ts')).toBe('path with spaces/file.ts');
    });

    it('returns null for non-diff lines', () => {
        expect(extractFilePathFromDiffHeader('index abc..def 100644')).toBeNull();
        expect(extractFilePathFromDiffHeader('')).toBeNull();
    });
});

describe('computeSideBySideLines: filePath tracking', () => {
    it('sets filePath on first hunk header after diff --git meta', () => {
        const lines = [
            'diff --git a/src/auth.ts b/src/auth.ts',
            'index abc..def 100644',
            '--- a/src/auth.ts',
            '+++ b/src/auth.ts',
            '@@ -1,2 +1,2 @@',
            '-old',
            '+new',
        ];
        const diffLines = computeDiffLines(lines);
        const sxsLines = computeSideBySideLines(diffLines);

        // First non-empty row should be the hunk header with filePath
        const hunkRow = sxsLines.find(r => r.hunkHeader !== undefined);
        expect(hunkRow).toBeDefined();
        expect(hunkRow!.filePath).toBe('src/auth.ts');
    });

    it('tracks multiple file paths across multi-file diff', () => {
        const lines = [
            'diff --git a/file1.ts b/file1.ts',
            '--- a/file1.ts',
            '+++ b/file1.ts',
            '@@ -1 +1 @@',
            '-a',
            '+b',
            'diff --git a/file2.ts b/file2.ts',
            '--- a/file2.ts',
            '+++ b/file2.ts',
            '@@ -1 +1 @@',
            '-c',
            '+d',
        ];
        const diffLines = computeDiffLines(lines);
        const sxsLines = computeSideBySideLines(diffLines);

        const hunkRows = sxsLines.filter(r => r.hunkHeader !== undefined);
        expect(hunkRows).toHaveLength(2);
        expect(hunkRows[0].filePath).toBe('file1.ts');
        expect(hunkRows[1].filePath).toBe('file2.ts');
    });

    it('only sets filePath on first hunk header per file', () => {
        const lines = [
            'diff --git a/a.ts b/a.ts',
            '--- a/a.ts',
            '+++ b/a.ts',
            '@@ -1 +1 @@',
            '-x',
            '+y',
            '@@ -10 +10 @@',
            '-p',
            '+q',
        ];
        const diffLines = computeDiffLines(lines);
        const sxsLines = computeSideBySideLines(diffLines);

        const hunkRows = sxsLines.filter(r => r.hunkHeader !== undefined);
        expect(hunkRows).toHaveLength(2);
        expect(hunkRows[0].filePath).toBe('a.ts');
        // Second hunk in same file should NOT have filePath
        expect(hunkRows[1].filePath).toBeUndefined();
    });

    it('non-hunk rows do not have filePath', () => {
        const lines = [
            'diff --git a/a.ts b/a.ts',
            '--- a/a.ts',
            '+++ b/a.ts',
            '@@ -1 +1 @@',
            '-x',
            '+y',
        ];
        const diffLines = computeDiffLines(lines);
        const sxsLines = computeSideBySideLines(diffLines);

        const contentRows = sxsLines.filter(r => r.hunkHeader === undefined);
        for (const row of contentRows) {
            expect(row.filePath).toBeUndefined();
        }
    });
});

describe('UnifiedDiffViewerHandle: scrollToFile interface', () => {
    it('handle interface includes scrollToFile in source', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'UnifiedDiffViewer.tsx'),
            'utf-8'
        );
        expect(source).toContain('scrollToFile:');
        expect(source).toContain("scrollToFile: (filePath: string)");
    });
});

describe('SideBySideDiffViewer: data-file-path in source', () => {
    it('renders data-file-path on hunk header rows', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'SideBySideDiffViewer.tsx'),
            'utf-8'
        );
        expect(source).toContain('data-file-path={row.filePath');
    });

    it('has scrollToFile in imperative handle', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'SideBySideDiffViewer.tsx'),
            'utf-8'
        );
        expect(source).toContain('scrollToFile:');
    });
});
