import { describe, expect, it } from 'vitest';

// @ts-expect-error — a .mjs benchmark script with no type declarations.
import {
    formatResult,
    median,
    parseArgs,
    runnerArgs,
    summarize,
} from '../scripts/bench-symbol-storage.mjs';

describe('symbol-storage benchmark arguments', () => {
    it('defaults to the acceptance-criterion corpus and target size', () => {
        expect(parseArgs([])).toEqual({
            files: 100_000,
            runs: 5,
            targetLines: 32_000,
            json: false,
        });
    });

    it('parses explicit sizes and JSON output', () => {
        expect(parseArgs([
            '--files', '20', '--runs', '3', '--target-lines', '400', '--json',
        ])).toEqual({ files: 20, runs: 3, targetLines: 400, json: true });
    });

    it('rejects missing, invalid, and unknown values', () => {
        expect(() => parseArgs(['--files'])).toThrow(/needs a value/);
        expect(() => parseArgs(['--runs', '0'])).toThrow(/positive integer/);
        expect(() => parseArgs(['--unknown'])).toThrow(/unknown option/);
    });

    it('passes every workload size to the production Rust runner', () => {
        const args = runnerArgs(parseArgs(['--files', '20', '--runs', '3', '--target-lines', '400']));
        expect(args).toContain('bench-symbol-storage');
        expect(args.slice(-6)).toEqual([
            '--files', '20', '--runs', '3', '--target-lines', '400',
        ]);
    });
});

describe('symbol-storage benchmark reporting', () => {
    it('computes medians without mutating samples', () => {
        const samples = [30, 10, 20, 40];
        expect(median(samples)).toBe(25);
        expect(samples).toEqual([30, 10, 20, 40]);
    });

    it('reports measured manifest and targeted-update medians', () => {
        const result = summarize({
            host: { platform: 'linux', architecture: 'arm64', logicalCpus: 2 },
            files: 100_000,
            targetLines: 32_000,
            fixtureMs: 1,
            initialIndexMs: 2,
            manifestSamplesMs: [800, 600, 700],
            targetedSamplesMs: [30, 10, 20],
        });
        expect(result).toMatchObject({ manifestMedianMs: 700, targetedMedianMs: 20 });
        expect(formatResult(result)).toContain('Host: linux-arm64, 2 logical CPUs');
        expect(formatResult(result)).toContain('100,000 C-family files');
        expect(formatResult(result)).toContain('Warm manifest diff median: 700.0 ms');
        expect(formatResult(result)).toContain('Targeted update median: 20.0 ms');
    });
});
