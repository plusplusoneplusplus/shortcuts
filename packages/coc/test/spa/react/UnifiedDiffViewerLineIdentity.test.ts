/**
 * Tests for UnifiedDiffViewer line identity features:
 * parseHunkHeader, computeDiffLines, DiffLine interface,
 * and new prop declarations.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    parseHunkHeader,
    computeDiffLines,
} from '../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'UnifiedDiffViewer.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('parseHunkHeader', () => {
    it('parses standard hunk header with counts', () => {
        expect(parseHunkHeader('@@ -10,6 +12,8 @@')).toEqual({ oldStart: 10, newStart: 12 });
    });

    it('parses single-line hunk header (no comma/count)', () => {
        expect(parseHunkHeader('@@ -1 +1 @@')).toEqual({ oldStart: 1, newStart: 1 });
    });

    it('returns null for non-hunk lines', () => {
        expect(parseHunkHeader('+added line')).toBeNull();
        expect(parseHunkHeader('-removed line')).toBeNull();
        expect(parseHunkHeader(' context line')).toBeNull();
        expect(parseHunkHeader('')).toBeNull();
    });
});

describe('computeDiffLines — basic structure', () => {
    const lines = [
        'diff --git a/foo.ts b/foo.ts',
        '@@ -1,3 +1,3 @@',
        ' context',
        '-removed',
        '+added',
    ];

    it('returns same number of entries as input lines', () => {
        expect(computeDiffLines(lines)).toHaveLength(lines.length);
    });

    it('each entry has index equal to its position', () => {
        const result = computeDiffLines(lines);
        result.forEach((dl, i) => expect(dl.index).toBe(i));
    });

    it('each entry has content equal to original line string', () => {
        const result = computeDiffLines(lines);
        result.forEach((dl, i) => expect(dl.content).toBe(lines[i]));
    });
});

describe('computeDiffLines — line number assignment', () => {
    it('before first @@ header, oldLine and newLine are undefined', () => {
        const lines = ['diff --git a/foo.ts b/foo.ts', '--- a/foo.ts', '+++ b/foo.ts'];
        const result = computeDiffLines(lines);
        result.forEach(dl => {
            expect(dl.oldLine).toBeUndefined();
            expect(dl.newLine).toBeUndefined();
        });
    });

    it('hunk-header line itself has oldLine and newLine undefined', () => {
        const lines = ['@@ -10,6 +12,8 @@'];
        const result = computeDiffLines(lines);
        expect(result[0].type).toBe('hunk-header');
        expect(result[0].oldLine).toBeUndefined();
        expect(result[0].newLine).toBeUndefined();
    });

    it('first context line after hunk header gets correct line numbers', () => {
        const lines = ['@@ -10,6 +12,8 @@', ' context'];
        const result = computeDiffLines(lines);
        expect(result[1].oldLine).toBe(10);
        expect(result[1].newLine).toBe(12);
    });

    it('second context line increments both counters', () => {
        const lines = ['@@ -10,6 +12,8 @@', ' context1', ' context2'];
        const result = computeDiffLines(lines);
        expect(result[2].oldLine).toBe(11);
        expect(result[2].newLine).toBe(13);
    });

    it('removed line gets oldLine only; next context increments oldLine', () => {
        const lines = ['@@ -5,3 +5,3 @@', '-removed', ' context'];
        const result = computeDiffLines(lines);
        expect(result[1].type).toBe('removed');
        expect(result[1].oldLine).toBe(5);
        expect(result[1].newLine).toBeUndefined();
        expect(result[2].oldLine).toBe(6);
        expect(result[2].newLine).toBe(5);
    });

    it('added line gets newLine only; next context increments newLine', () => {
        const lines = ['@@ -5,3 +5,3 @@', '+added', ' context'];
        const result = computeDiffLines(lines);
        expect(result[1].type).toBe('added');
        expect(result[1].newLine).toBe(5);
        expect(result[1].oldLine).toBeUndefined();
        expect(result[2].newLine).toBe(6);
        expect(result[2].oldLine).toBe(5);
    });

    it('meta lines have no oldLine/newLine regardless of cursor state', () => {
        const lines = ['@@ -5,3 +5,3 @@', 'diff --git a/foo.ts b/foo.ts'];
        const result = computeDiffLines(lines);
        expect(result[1].type).toBe('meta');
        expect(result[1].oldLine).toBeUndefined();
        expect(result[1].newLine).toBeUndefined();
    });

    it('multi-hunk diff resets cursors at second @@ header', () => {
        const lines = [
            '@@ -1,2 +1,2 @@',
            ' ctx1',
            ' ctx2',
            '@@ -20,2 +30,2 @@',
            ' ctx3',
        ];
        const result = computeDiffLines(lines);
        // Second hunk header resets
        expect(result[3].type).toBe('hunk-header');
        expect(result[4].oldLine).toBe(20);
        expect(result[4].newLine).toBe(30);
    });

    it('full acceptance-criteria scenario: 3-line hunk', () => {
        const lines = [
            '@@ -5,3 +5,3 @@',
            ' context',
            '-removed',
            '+added',
            ' next-context',
        ];
        const result = computeDiffLines(lines);
        expect(result[1]).toMatchObject({ type: 'context', oldLine: 5, newLine: 5 });
        expect(result[2].type).toBe('removed');
        expect(result[2].oldLine).toBe(6);
        expect(result[2].newLine).toBeUndefined();
        expect(result[3].type).toBe('added');
        expect(result[3].newLine).toBe(6);
        expect(result[3].oldLine).toBeUndefined();
        expect(result[4]).toMatchObject({ type: 'context', oldLine: 7, newLine: 7 });
    });
});

describe('DiffLine type and new exports', () => {
    let source: string;
    let indexSource: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
        indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
    });

    it('source file exports DiffLine interface', () => {
        expect(source).toContain('export interface DiffLine');
    });

    it('index.ts exports DiffLine type', () => {
        expect(indexSource).toContain("DiffLine");
        expect(indexSource).toContain("from './UnifiedDiffViewer'");
    });

    it('source exports computeDiffLines', () => {
        expect(source).toContain('export function computeDiffLines');
    });

    it('source exports parseHunkHeader', () => {
        expect(source).toContain('export function parseHunkHeader');
    });

    it('index.ts exports computeDiffLines', () => {
        expect(indexSource).toContain('computeDiffLines');
    });

    it('index.ts exports parseHunkHeader', () => {
        expect(indexSource).toContain('parseHunkHeader');
    });
});

describe('UnifiedDiffViewer new props (structural)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    it('source contains enableComments prop', () => {
        expect(source).toContain('enableComments?: boolean');
    });

    it('source contains showLineNumbers prop', () => {
        expect(source).toContain('showLineNumbers?: boolean');
    });

    it('source contains onLinesReady prop', () => {
        expect(source).toContain('onLinesReady?');
    });

    it('source contains data-diff-line-index attribute', () => {
        expect(source).toContain('data-diff-line-index');
    });

    it('source contains data-old-line attribute', () => {
        expect(source).toContain('data-old-line');
    });

    it('source contains data-new-line attribute', () => {
        expect(source).toContain('data-new-line');
    });

    it('source contains data-line-type attribute', () => {
        expect(source).toContain('data-line-type');
    });

    it('source contains gutter class for line numbers', () => {
        expect(source).toContain('select-none text-right w-8 inline-block');
    });

    it('source imports useEffect from react', () => {
        expect(source).toContain('useEffect');
        expect(source).toContain("from 'react'");
    });
});
