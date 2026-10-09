/**
 * Tests for scrollToFile handle method and data-file-path attributes
 * in UnifiedDiffViewer and SideBySideDiffViewer.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createElement, createRef } from 'react';
import {
    computeDiffLines,
    computeSideBySideLines,
    extractFilePathFromDiffHeader,
    type UnifiedDiffViewerHandle,
} from '../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';

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
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'diff', 'UnifiedDiffViewer.tsx'),
            'utf-8'
        );
        expect(source).toContain('scrollToFile:');
        expect(source).toContain("scrollToFile: (filePath: string)");
    });
});

describe('SideBySideDiffViewer: file scrolling', () => {
    it('renders data-file-path on hunk header rows', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'diff', 'SideBySideDiffViewer.tsx'),
            'utf-8'
        );
        expect(source).toContain('data-file-path={row.filePath');
    });

    it.each([false, true])('scrolls through its public handle with file banners %s', showFileBanners => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const diff = [
            'diff --git a/first.ts b/first.ts',
            '--- a/first.ts', '+++ b/first.ts', '@@ -1 +1 @@', '-old', '+new',
            'diff --git a/second.ts b/second.ts',
            '--- a/second.ts', '+++ b/second.ts', '@@ -1 +1 @@', '-before', '+after',
        ].join('\n');
        const view = render(createElement('div', { 'data-testid': 'scroller', style: { overflowY: 'scroll' } },
            createElement(SideBySideDiffViewer, { ref, diff, showFileBanners })));
        const scroller = view.container.querySelector<HTMLElement>('[data-testid="scroller"]')!;
        const target = view.container.querySelector<HTMLElement>('[data-file-path="second.ts"]')!;
        const scrollTo = vi.fn();
        scroller.scrollTo = scrollTo;
        scroller.scrollTop = 20;
        scroller.getBoundingClientRect = () => new DOMRect(0, 100, 800, 600);
        target.getBoundingClientRect = () => new DOMRect(0, 180, 800, 24);

        expect(ref.current?.scrollToFile).toBeTypeOf('function');
        act(() => ref.current!.scrollToFile('second.ts'));
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 100, behavior: 'smooth' });
        act(() => ref.current!.scrollToFile('missing.ts'));
        expect(scrollTo).toHaveBeenCalledOnce();
    });
});
