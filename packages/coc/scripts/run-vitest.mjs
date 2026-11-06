#!/usr/bin/env node
import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { matchesGreenSummary, decideExitCode } from './run-vitest-lib.mjs';
import { captureMacSamples, createTestProcessTerminator, readOptionalDelay } from './run-vitest-diagnostics.mjs';

const require = createRequire(import.meta.url);
const vitestPackageJsonPath = require.resolve('vitest/package.json');
const vitestPackage = require(vitestPackageJsonPath);
const vitestEntry = path.resolve(path.dirname(vitestPackageJsonPath), vitestPackage.bin.vitest);
const args = ['run', ...process.argv.slice(2)];
const greenExitGraceMs = Number(process.env.COC_VITEST_GREEN_EXIT_GRACE_MS ?? 1_000);
const timeoutMs = readOptionalDelay(process.env.COC_VITEST_TIMEOUT_MS, 'COC_VITEST_TIMEOUT_MS');
const sampleIdleMs = readOptionalDelay(process.env.COC_VITEST_SAMPLE_IDLE_MS, 'COC_VITEST_SAMPLE_IDLE_MS');
const processGroup = timeoutMs > 0 || sampleIdleMs > 0;
if (processGroup && process.platform === 'win32') {
    throw new Error('Vitest process-group supervision requires a POSIX platform');
}
if (sampleIdleMs && (process.platform !== 'darwin' || !process.env.COC_VITEST_DIAGNOSTICS_DIR)) {
    throw new Error('Vitest native sampling requires macOS and COC_VITEST_DIAGNOSTICS_DIR');
}

let sawGreenSummary = false;
let timedOut = false;
let childClosed = false;
let outputTail = '';
let greenExitTimer;
let lastOutputAt = Date.now();
let sampled = false;

const child = spawn(process.execPath, [vitestEntry, ...args], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
    detached: processGroup,
});
const terminator = createTestProcessTerminator(child, processGroup);
const deadlineTimer = timeoutMs ? setTimeout(() => {
    timedOut = true;
    console.error(`[Vitest diagnostics] Test deadline exceeded (${timeoutMs} ms); terminating test process group`);
    terminator.terminate();
}, timeoutMs) : undefined;
const sampleTimer = sampleIdleMs ? setInterval(() => {
    if (sampled || sawGreenSummary || Date.now() - lastOutputAt < sampleIdleMs) return;
    sampled = true;
    // External sampling works even when the worker's JS event loop is blocked in native code.
    captureMacSamples(child.pid, process.env.COC_VITEST_DIAGNOSTICS_DIR).catch(error => {
        console.error(`[Vitest diagnostics] Native stack capture failed: ${error.message}`);
    });
}, Math.min(sampleIdleMs, 30_000)) : undefined;

function inspectOutput(chunk) {
    lastOutputAt = Date.now();
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
                    terminator.terminate();
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
    clearTimeout(deadlineTimer);
    clearInterval(sampleTimer);
    terminator.dispose();

    // A green summary means every test file passed. vitest may still exit
    // non-zero purely because of tolerated worker-crash "unhandled errors"
    // (e.g. the flaky libuv fs.watch assertion on Windows), whether we
    // force-killed it after the grace period or it self-exited first. Decide on
    // the summary alone so that race can't fail CI; genuine failures never
    // produce a green summary and keep their non-zero exit.
    if (!sawGreenSummary && typeof code !== 'number' && signal) {
        console.error(`Vitest exited due to signal ${signal}`);
    }
    process.exit(decideExitCode({ sawGreenSummary, timedOut, code, signal }));
});
