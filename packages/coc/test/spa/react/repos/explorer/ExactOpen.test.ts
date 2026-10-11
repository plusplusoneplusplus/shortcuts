/**
 * Tests for ExactOpen component — Ctrl+O exact filename matcher.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';

const EXACT_OPEN_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'explorer', 'ExactOpen.tsx'
);

describe('exactMatchScore algorithm', () => {
    let exactMatchScore: (query: string, filePath: string) => 0 | 1 | 2;
    let fileNameFn: (p: string) => string;

    beforeAll(async () => {
        const mod = await import(EXACT_OPEN_PATH.replace(/\.tsx$/, ''));
        exactMatchScore = mod.exactMatchScore;
        fileNameFn = mod.fileName;
    });

    describe('fileName helper', () => {
        it('returns filename from path', () => {
            expect(fileNameFn('src/index.ts')).toBe('index.ts');
        });

        it('returns full string when no slash', () => {
            expect(fileNameFn('index.ts')).toBe('index.ts');
        });

        it('handles nested paths', () => {
            expect(fileNameFn('a/b/c/file.ts')).toBe('file.ts');
        });
    });

    describe('exact match (score 2)', () => {
        it('returns 2 for exact basename match', () => {
            expect(exactMatchScore('index.ts', 'src/index.ts')).toBe(2);
        });

        it('is case-insensitive for exact match', () => {
            expect(exactMatchScore('Index.TS', 'src/index.ts')).toBe(2);
        });

        it('returns 2 for file at root', () => {
            expect(exactMatchScore('index.ts', 'index.ts')).toBe(2);
        });
    });

    describe('prefix match (score 1)', () => {
        it('returns 1 for prefix match', () => {
            expect(exactMatchScore('ind', 'src/index.ts')).toBe(1);
        });

        it('returns 1 for case-insensitive prefix', () => {
            expect(exactMatchScore('IND', 'src/index.ts')).toBe(1);
        });

        it('returns 1 for empty query (show all)', () => {
            expect(exactMatchScore('', 'src/index.ts')).toBe(1);
        });
    });

    describe('no match (score 0)', () => {
        it('returns 0 when basename does not start with query', () => {
            expect(exactMatchScore('xyz', 'src/index.ts')).toBe(0);
        });

        it('returns 0 when query matches directory but not basename', () => {
            expect(exactMatchScore('src', 'src/index.ts')).toBe(0);
        });

        it('returns 0 when query is longer than basename', () => {
            expect(exactMatchScore('index.ts.extra', 'src/index.ts')).toBe(0);
        });
    });

    describe('ranking', () => {
        it('exact match scores higher than prefix match', () => {
            const exact = exactMatchScore('index.ts', 'src/index.ts');
            const prefix = exactMatchScore('index', 'src/index.ts');
            expect(exact).toBeGreaterThan(prefix);
        });

        it('prefix match scores higher than no match', () => {
            const prefix = exactMatchScore('ind', 'src/index.ts');
            const none = exactMatchScore('xyz', 'src/index.ts');
            expect(prefix).toBeGreaterThan(none);
        });
    });
});

describe('isAbsolutePath detection', () => {
    let isAbsolutePath: (query: string) => boolean;

    beforeAll(async () => {
        const mod = await import(EXACT_OPEN_PATH.replace(/\.tsx$/, ''));
        isAbsolutePath = mod.isAbsolutePath;
    });

    it('detects Unix absolute paths', () => {
        expect(isAbsolutePath('/home/user/file.txt')).toBe(true);
        expect(isAbsolutePath('/etc/config')).toBe(true);
    });

    it('detects home-dir paths (~)', () => {
        expect(isAbsolutePath('~/.copilot/plan.md')).toBe(true);
        expect(isAbsolutePath('~/Documents/file.txt')).toBe(true);
    });

    it('detects Windows drive letter paths', () => {
        expect(isAbsolutePath('C:\\Users\\test')).toBe(true);
        expect(isAbsolutePath('D:/projects/file.ts')).toBe(true);
        expect(isAbsolutePath('c:\\lower')).toBe(true);
    });

    it('rejects relative paths', () => {
        expect(isAbsolutePath('src/index.ts')).toBe(false);
        expect(isAbsolutePath('file.txt')).toBe(false);
        expect(isAbsolutePath('package.json')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isAbsolutePath('')).toBe(false);
        expect(isAbsolutePath('  ')).toBe(false);
    });

    it('handles whitespace trimming', () => {
        expect(isAbsolutePath('  /usr/bin/node  ')).toBe(true);
        expect(isAbsolutePath('  C:\\path  ')).toBe(true);
    });
});
