#!/usr/bin/env node
import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const vitestEntry = require.resolve('vitest/vitest.mjs');
const args = ['run', ...process.argv.slice(2)];
const greenExitGraceMs = Number(process.env.COC_VITEST_GREEN_EXIT_GRACE_MS ?? 1_000);

let sawGreenSummary = false;
let forcedGreenExit = false;
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
    if (/^\s*Test Files\s+(?!.*\bfailed\b)(?=.*\bpassed\b).*/m.test(text)) {
        sawGreenSummary = true;
        if (!greenExitTimer) {
            greenExitTimer = setTimeout(() => {
                if (!childClosed) {
                    forcedGreenExit = true;
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

    if (forcedGreenExit && sawGreenSummary) {
        process.exit(0);
    }
    if (typeof code === 'number') {
        process.exit(code);
    }
    if (signal) {
        console.error(`Vitest exited due to signal ${signal}`);
    }
    process.exit(1);
});
