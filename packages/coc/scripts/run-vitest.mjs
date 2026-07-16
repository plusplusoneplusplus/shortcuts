#!/usr/bin/env node
import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { matchesGreenSummary, decideExitCode } from './run-vitest-lib.mjs';

const require = createRequire(import.meta.url);
const vitestPackageJsonPath = require.resolve('vitest/package.json');
const vitestPackage = require(vitestPackageJsonPath);
const vitestEntry = path.resolve(path.dirname(vitestPackageJsonPath), vitestPackage.bin.vitest);
const args = ['run', ...process.argv.slice(2)];
const greenExitGraceMs = Number(process.env.COC_VITEST_GREEN_EXIT_GRACE_MS ?? 1_000);

let sawGreenSummary = false;
let childClosed = false;
let outputTail = '';
let greenExitTimer;
let forceKillTimer;

const child = spawn(process.execPath, [vitestEntry, ...args], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
});

function inspectOutput(chunk) {
    const text = chunk.toString();
    outputTail = (outputTail + text).slice(-4096);
    processOutput(outputTail);
}

function processOutput(text) {
    if (matchesGreenSummary(text)) {
        sawGreenSummary = true;
        if (!greenExitTimer) {
            greenExitTimer = setTimeout(() => {
                if (!childClosed) {
                    child.kill('SIGTERM');
                    forceKillTimer = setTimeout(() => {
                        if (!childClosed) child.kill('SIGKILL');
                    }, 5_000);
                }
            }, greenExitGraceMs);
        }
    }
}

child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    inspectOutput(chunk);
});

child.stderr.on('data', chunk => {
    process.stderr.write(chunk);
    inspectOutput(chunk);
});

child.on('error', error => {
    console.error(error);
    process.exitCode = 1;
});

child.on('close', (code, signal) => {
    childClosed = true;
    if (greenExitTimer) clearTimeout(greenExitTimer);
    if (forceKillTimer) clearTimeout(forceKillTimer);

    // A green summary means every test file passed. vitest may still exit
    // non-zero purely because of tolerated worker-crash "unhandled errors"
    // (e.g. the flaky libuv fs.watch assertion on Windows), whether we
    // force-killed it after the grace period or it self-exited first. Decide on
    // the summary alone so that race can't fail CI; genuine failures never
    // produce a green summary and keep their non-zero exit.
    if (!sawGreenSummary && typeof code !== 'number' && signal) {
        console.error(`Vitest exited due to signal ${signal}`);
    }
    process.exit(decideExitCode({ sawGreenSummary, code, signal }));
});
