/**
 * Measure the production tree-sitter C-family extractor over a repository.
 *
 * The Rust runner reports only time spent walking, reading, parsing, and
 * executing the bundled tags queries. Cargo and process startup stay outside
 * the measured interval. Use --drop-linux-page-cache for an explicit cold pass.
 */

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCargo } from './ensure-native.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(packageRoot, 'rust', 'Cargo.toml');
export const DEFAULT_EXCLUDES = ['clang/test/Parser/parser_overflow.c'];
export const DEFAULT_EXTENSIONS = [
    'c', 'cc', 'cpp', 'cxx', 'c++', 'm', 'mm',
    'h', 'hh', 'hpp', 'hxx', 'inc', 'ipp', 'tcc', 'def',
];

function positiveInteger(value, option) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer`);
    return parsed;
}

function optionValue(argv, index) {
    if (index + 1 >= argv.length) throw new Error(`${argv[index]} needs a value`);
    return argv[index + 1];
}

export function parseArgs(argv) {
    const options = {
        repo: null,
        threads: [...new Set([1, os.availableParallelism()])],
        warmup: 1,
        runs: 3,
        excludes: [...DEFAULT_EXCLUDES],
        extensions: [...DEFAULT_EXTENSIONS],
        cold: false,
        json: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--drop-linux-page-cache') options.cold = true;
        else if (argument === '--json') options.json = true;
        else if (argument === '--repo') options.repo = path.resolve(optionValue(argv, index++));
        else if (argument === '--threads') {
            options.threads = [...new Set(optionValue(argv, index++).split(',').map(value => positiveInteger(value, '--threads')))];
        } else if (argument === '--warmup') options.warmup = positiveInteger(optionValue(argv, index++), '--warmup');
        else if (argument === '--runs') options.runs = positiveInteger(optionValue(argv, index++), '--runs');
        else if (argument === '--exclude') options.excludes.push(optionValue(argv, index++).split(path.sep).join('/'));
        else if (argument === '--extensions') {
            options.extensions = optionValue(argv, index++)
                .split(',')
                .map(value => value.trim().replace(/^\./, '').toLowerCase())
                .filter(Boolean);
            if (options.extensions.length === 0) throw new Error('--extensions must not be empty');
        }
        else throw new Error(`unknown option ${argument}`);
    }
    if (!options.repo) throw new Error('--repo is required');
    return options;
}

export function summarize(samples) {
    const ordered = [...samples].sort((left, right) => left.extractionMs - right.extractionMs);
    const middle = Math.floor(ordered.length / 2);
    const median = ordered.length % 2 === 1
        ? ordered[middle]
        : {
            ...ordered[middle],
            extractionMs: (ordered[middle - 1].extractionMs + ordered[middle].extractionMs) / 2,
            walkMs: (ordered[middle - 1].walkMs + ordered[middle].walkMs) / 2,
        };
    const megabytes = median.bytes / 1_000_000;
    const megabytesPerSecond = megabytes / (median.extractionMs / 1_000);
    return {
        ...median,
        megabytesPerSecond,
        megabytesPerSecondPerCore: megabytesPerSecond / median.threads,
        samples: ordered.length,
    };
}

export function runnerArgs(options, threads) {
    const args = [
        'run', '--quiet', '--release', '--manifest-path', manifest,
        '-p', 'coc-native-core', '--bin', 'bench-symbol-index', '--',
        '--root', options.repo, '--threads', String(threads),
    ];
    for (const excluded of options.excludes) args.push('--exclude', excluded);
    for (const extension of options.extensions) args.push('--extension', extension);
    return args;
}

export function dropLinuxPageCache(platform = process.platform) {
    if (platform !== 'linux') throw new Error('--drop-linux-page-cache is supported only on Linux');
    execFileSync('sync', [], { stdio: 'ignore' });
    execFileSync('sudo', ['-n', 'tee', '/proc/sys/vm/drop_caches'], {
        input: '3\n',
        stdio: ['pipe', 'ignore', 'pipe'],
    });
}

export function runPass(options, threads) {
    const cargo = resolveCargo();
    if (!cargo) throw new Error('cargo is required; run `npm run ensure:native -w packages/coc-native`');
    const output = execFileSync(cargo, runnerArgs(options, threads), {
        cwd: packageRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(output);
}

export function formatResults(results) {
    const lines = [
        'Threads  Cache  Files   MB        Extract     MB/s      MB/s/core   Symbols   Failures',
    ];
    for (const result of results) {
        lines.push(
            `${String(result.threads).padEnd(8)} ${result.cache.padEnd(6)} ` +
            `${String(result.files).padEnd(7)} ${(result.bytes / 1_000_000).toFixed(1).padEnd(9)} ` +
            `${`${result.extractionMs.toFixed(0)} ms`.padEnd(11)} ` +
            `${result.megabytesPerSecond.toFixed(1).padEnd(9)} ${result.megabytesPerSecondPerCore.toFixed(1).padEnd(11)} ` +
            `${String(result.symbols).padEnd(9)} ${result.failures}`,
        );
    }
    return lines.join('\n');
}

export function benchmark(options) {
    const results = [];
    for (const threads of options.threads) {
        if (options.cold) {
            dropLinuxPageCache();
            results.push({ ...summarize([runPass(options, threads)]), cache: 'cold' });
        }
        for (let run = 0; run < options.warmup; run += 1) runPass(options, threads);
        const samples = Array.from({ length: options.runs }, () => runPass(options, threads));
        results.push({ ...summarize(samples), cache: 'warm' });
    }
    return {
        host: {
            platform: process.platform,
            architecture: process.arch,
            logicalCpus: os.availableParallelism(),
        },
        repository: options.repo,
        excludedPaths: options.excludes,
        results,
    };
}

function main(argv) {
    try {
        const options = parseArgs(argv);
        const report = benchmark(options);
        console.log(options.json ? JSON.stringify(report, null, 2) : formatResults(report.results));
    } catch (error) {
        console.error(`symbol-index benchmark: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2));
}
