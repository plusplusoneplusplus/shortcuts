/**
 * Behavioral tests for UnifiedDiffViewer helper functions.
 *
 * Tests extractFilePathFromDiffHeader and getLanguagesForLines
 * for per-file syntax highlighting in commit-level diffs.
 */

import { describe, it, expect } from 'vitest';
import {
    extractFilePathFromDiffHeader,
    getLanguagesForLines,
} from '../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

describe('extractFilePathFromDiffHeader', () => {
    it('extracts file path from standard diff header', () => {
        expect(extractFilePathFromDiffHeader('diff --git a/src/index.ts b/src/index.ts')).toBe('src/index.ts');
    });

    it('extracts the b/ path (prefers "after" path for renames)', () => {
        expect(extractFilePathFromDiffHeader('diff --git a/old/name.ts b/new/name.ts')).toBe('new/name.ts');
    });

    it('handles deeply nested paths', () => {
        expect(extractFilePathFromDiffHeader('diff --git a/packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx b/packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx'))
            .toBe('packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx');
    });

    it('handles filenames with spaces', () => {
        expect(extractFilePathFromDiffHeader('diff --git a/my file.ts b/my file.ts')).toBe('my file.ts');
    });

    it('returns null for non-diff lines', () => {
        expect(extractFilePathFromDiffHeader('index abc123..def456 100644')).toBeNull();
        expect(extractFilePathFromDiffHeader('+const x = 1;')).toBeNull();
        expect(extractFilePathFromDiffHeader('')).toBeNull();
    });

    it('returns null for malformed diff headers', () => {
        expect(extractFilePathFromDiffHeader('diff --git')).toBeNull();
        expect(extractFilePathFromDiffHeader('diff --git a/file')).toBeNull();
    });
});

describe('getLanguagesForLines', () => {
    it('returns same language for all lines when fileName is provided', () => {
        const lines = [
            'diff --git a/script.py b/script.py',
            '--- a/script.py',
            '+++ b/script.py',
            '@@ -1,3 +1,3 @@',
            '-old line',
            '+new line',
            ' context',
        ];
        const result = getLanguagesForLines(lines, 'component.tsx');
        expect(result).toEqual(Array(7).fill('typescript'));
    });

    it('switches language at diff --git boundaries when fileName is undefined', () => {
        const lines = [
            'diff --git a/index.ts b/index.ts',
            '--- a/index.ts',
            '+++ b/index.ts',
            '@@ -1,2 +1,2 @@',
            '-const x = 1;',
            '+const x = 2;',
            'diff --git a/script.py b/script.py',
            '--- a/script.py',
            '+++ b/script.py',
            '@@ -1,2 +1,2 @@',
            '-x = 1',
            '+x = 2',
        ];
        const result = getLanguagesForLines(lines, undefined);
        // First 6 lines: typescript
        expect(result.slice(0, 6)).toEqual(Array(6).fill('typescript'));
        // Next 6 lines: python
        expect(result.slice(6)).toEqual(Array(6).fill('python'));
    });

    it('returns null for lines before first diff --git header', () => {
        const lines = [
            'some preamble',
            'diff --git a/file.ts b/file.ts',
            '+const x = 1;',
        ];
        const result = getLanguagesForLines(lines, undefined);
        expect(result[0]).toBeNull();
        expect(result[1]).toBe('typescript');
        expect(result[2]).toBe('typescript');
    });

    it('returns null language for unrecognized file extensions', () => {
        const lines = [
            'diff --git a/data.bin b/data.bin',
            '+binary content',
        ];
        const result = getLanguagesForLines(lines, undefined);
        expect(result[0]).toBeNull();
        expect(result[1]).toBeNull();
    });

    it('handles mix of recognized and unrecognized file extensions', () => {
        const lines = [
            'diff --git a/app.ts b/app.ts',
            '+const x = 1;',
            'diff --git a/data.bin b/data.bin',
            '+binary stuff',
            'diff --git a/style.css b/style.css',
            '+body { }',
        ];
        const result = getLanguagesForLines(lines, undefined);
        expect(result[0]).toBe('typescript');
        expect(result[1]).toBe('typescript');
        expect(result[2]).toBeNull();
        expect(result[3]).toBeNull();
        expect(result[4]).toBe('css');
        expect(result[5]).toBe('css');
    });

    it('single-file diff without fileName extracts language from header', () => {
        const lines = [
            'diff --git a/main.go b/main.go',
            '--- a/main.go',
            '+++ b/main.go',
            '@@ -1,3 +1,3 @@',
            ' package main',
            '-func old() {}',
            '+func new() {}',
        ];
        const result = getLanguagesForLines(lines, undefined);
        expect(new Set(result)).toEqual(new Set(['go']));
    });

    it('handles empty lines array', () => {
        expect(getLanguagesForLines([], undefined)).toEqual([]);
        expect(getLanguagesForLines([], 'file.ts')).toEqual([]);
    });

    it('handles rename diffs (a/ and b/ paths differ)', () => {
        const lines = [
            'diff --git a/old.js b/new.ts',
            'rename from old.js',
            'rename to new.ts',
            '+const x: number = 1;',
        ];
        const result = getLanguagesForLines(lines, undefined);
        // Uses b/ path (new.ts) → typescript
        expect(result).toEqual(Array(4).fill('typescript'));
    });
});
