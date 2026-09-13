import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a .mjs benchmark script with no type declarations.
import {
    DEFAULT_EXCLUDES,
    DEFAULT_EXTENSIONS,
    formatResults,
    parseArgs,
    runnerArgs,
    summarize,
} from '../scripts/bench-symbol-index.mjs';

describe('symbol-index benchmark arguments', () => {
    it('defaults to single-core and all-core warm measurements', () => {
        const options = parseArgs(['--repo', '.']);
        expect(options.repo).toBe(path.resolve('.'));
        expect(options.threads[0]).toBe(1);
        expect(options.threads.at(-1)).toBeGreaterThan(0);
        expect(options.excludes).toEqual(DEFAULT_EXCLUDES);
        expect(options.extensions).toEqual(DEFAULT_EXTENSIONS);
        expect(options).toMatchObject({ warmup: 1, runs: 3, cold: false, json: false });
    });

    it('parses explicit scaling, cold-cache, and corpus options', () => {
        const options = parseArgs([
            '--repo', '.', '--threads', '1,4,8,4', '--warmup', '2', '--runs', '5',
            '--exclude', path.join('other', 'bad.cpp'), '--extensions', '.c,CPP',
            '--drop-linux-page-cache', '--json',
        ]);
        expect(options.threads).toEqual([1, 4, 8]);
        expect(options.excludes).toContain('other/bad.cpp');
        expect(options.extensions).toEqual(['c', 'cpp']);
        expect(options).toMatchObject({ warmup: 2, runs: 5, cold: true, json: true });
    });

    it('rejects missing and invalid values', () => {
        expect(() => parseArgs([])).toThrow(/--repo is required/);
        expect(() => parseArgs(['--repo'])).toThrow(/needs a value/);
        expect(() => parseArgs(['--repo', '.', '--threads', '0'])).toThrow(/positive integer/);
        expect(() => parseArgs(['--repo', '.', '--extensions', ','])).toThrow(/must not be empty/);
        expect(() => parseArgs(['--repo', '.', '--unknown'])).toThrow(/unknown option/);
    });
});

describe('symbol-index benchmark reporting', () => {
    it('summarizes extraction throughput without including walk time', () => {
        const result = summarize([
            { threads: 2, bytes: 10 * 1024 * 1024, extractionMs: 200, walkMs: 30 },
            { threads: 2, bytes: 10 * 1024 * 1024, extractionMs: 100, walkMs: 10 },
            { threads: 2, bytes: 10 * 1024 * 1024, extractionMs: 300, walkMs: 50 },
        ]);
        expect(result.extractionMs).toBe(200);
        expect(result.megabytesPerSecond).toBeCloseTo(52.4288);
        expect(result.megabytesPerSecondPerCore).toBeCloseTo(26.2144);
    });

    it('passes the same explicit corpus exclusions to every Rust run', () => {
        const options = parseArgs(['--repo', '.', '--exclude', 'extra.c']);
        const args = runnerArgs(options, 4);
        expect(args).toContain('bench-symbol-index');
        expect(args).toContain('4');
        expect(args.filter((value: string) => value === '--exclude')).toHaveLength(2);
        expect(args).toContain('clang/test/Parser/parser_overflow.c');
        expect(args).toContain('extra.c');
        expect(args.filter((value: string) => value === '--extension')).toHaveLength(
            DEFAULT_EXTENSIONS.length,
        );
    });

    it('prints cache state, total throughput, and per-core throughput', () => {
        const table = formatResults([{
            threads: 1,
            cache: 'warm',
            files: 2,
            bytes: 10 * 1024 * 1024,
            extractionMs: 200,
            megabytesPerSecond: 50,
            megabytesPerSecondPerCore: 50,
            symbols: 30,
            failures: 0,
        }]);
        expect(table).toContain('MB/s/core');
        expect(table).toContain('warm');
        expect(table).toContain('50.0');
    });
});
