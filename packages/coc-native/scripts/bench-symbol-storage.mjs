/**
 * Measure production manifest diff and targeted-update performance over a
 * generated C-family repository. Fixture creation and cold indexing are
 * reported separately from the warm measurements.
 */

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCargo } from './ensure-native.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(packageRoot, 'rust', 'Cargo.toml');

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
    const options = { files: 100_000, runs: 5, targetLines: 32_000, json: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--json') options.json = true;
        else if (argument === '--files') options.files = positiveInteger(optionValue(argv, index++), '--files');
        else if (argument === '--runs') options.runs = positiveInteger(optionValue(argv, index++), '--runs');
        else if (argument === '--target-lines') {
            options.targetLines = positiveInteger(optionValue(argv, index++), '--target-lines');
        } else throw new Error(`unknown option ${argument}`);
    }
    return options;
}

export function runnerArgs(options) {
    return [
        'run', '--quiet', '--release', '--manifest-path', manifest,
        '-p', 'coc-native-core', '--bin', 'bench-symbol-storage', '--',
        '--files', String(options.files),
        '--runs', String(options.runs),
        '--target-lines', String(options.targetLines),
    ];
}

export function median(samples) {
    const ordered = [...samples].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 1
        ? ordered[middle]
        : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function summarize(raw) {
    return {
        ...raw,
        manifestMedianMs: median(raw.manifestSamplesMs),
        targetedMedianMs: median(raw.targetedSamplesMs),
    };
}

export function formatResult(result) {
    return [
        `Host: ${result.host.platform}-${result.host.architecture}, ${result.host.logicalCpus} logical CPUs`,
        `Fixture: ${result.files.toLocaleString()} C-family files; target: ${result.targetLines.toLocaleString()} lines`,
        `Fixture creation: ${result.fixtureMs.toFixed(0)} ms`,
        `Initial index: ${result.initialIndexMs.toFixed(0)} ms`,
        `Warm manifest diff median: ${result.manifestMedianMs.toFixed(1)} ms`,
        `Targeted update median: ${result.targetedMedianMs.toFixed(1)} ms`,
    ].join('\n');
}

export function benchmark(options) {
    const cargo = resolveCargo();
    if (!cargo) throw new Error('cargo is required; run `npm run ensure:native -w packages/coc-native`');
    const output = execFileSync(cargo, runnerArgs(options), {
        cwd: packageRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    return {
        host: {
            platform: process.platform,
            architecture: process.arch,
            logicalCpus: os.availableParallelism(),
        },
        ...summarize(JSON.parse(output)),
    };
}

function main(argv) {
    try {
        const options = parseArgs(argv);
        const report = benchmark(options);
        console.log(options.json ? JSON.stringify(report, null, 2) : formatResult(report));
    } catch (error) {
        console.error(`symbol-storage benchmark: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2));
}
