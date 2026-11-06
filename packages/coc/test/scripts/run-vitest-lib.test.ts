/**
 * Regression coverage for the run-vitest.mjs exit-decision logic.
 *
 * Background: on Windows a flaky libuv `fs.watch` assertion
 * ("Assertion failed: !_wcsnicmp(filename, dir, dirlen)") aborts a vitest
 * worker fork *after* its tests have passed. vitest then reports the run as an
 * "unhandled error" and exits non-zero even though every test file passed.
 * The run-vitest.mjs wrapper is meant to tolerate this — a green "Test Files
 * … passed" summary should always exit 0. Previously it only did so when its
 * grace timer force-killed vitest first; when vitest self-exited non-zero
 * before the timer fired, the crash leaked through and failed CI. This test
 * pins the tolerant-but-safe behavior.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs helper, no type declarations
import { matchesGreenSummary, decideExitCode } from '../../scripts/run-vitest-lib.mjs';
// @ts-ignore -- plain .mjs helpers, no type declarations
import { captureMacSamples, createTestProcessTerminator, readOptionalDelay, selectProcessGroupPids } from '../../scripts/run-vitest-diagnostics.mjs';

describe('run-vitest green-summary detection', () => {
    it('matches an all-passed summary', () => {
        expect(matchesGreenSummary(' Test Files  337 passed (340)\n')).toBe(true);
    });

    it('does not match when some test files failed', () => {
        expect(matchesGreenSummary(' Test Files  2 failed | 335 passed (337)\n')).toBe(false);
    });

    it('does not match an all-failed summary', () => {
        expect(matchesGreenSummary(' Test Files  340 failed (340)\n')).toBe(false);
    });

    it('does not match when there is no summary yet', () => {
        expect(matchesGreenSummary('running tests...\n')).toBe(false);
    });

    // Regression: vitest colorizes its summary in CI, so the line starts with an
    // ANSI escape (`\x1b[2m Test Files ...`) rather than whitespace. The matcher
    // must strip ANSI first, otherwise green runs are never detected and the
    // wrapper propagates vitest's non-zero exit from tolerated worker crashes.
    it('matches an ANSI-colored all-passed summary', () => {
        const colored = '\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m337 passed\x1b[39m\x1b[22m\x1b[90m (340)\x1b[39m\n';
        expect(matchesGreenSummary(colored)).toBe(true);
    });

    it('does not match an ANSI-colored summary with failures', () => {
        const colored = '\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m2 failed\x1b[39m \x1b[90m|\x1b[39m \x1b[32m335 passed\x1b[39m (337)\n';
        expect(matchesGreenSummary(colored)).toBe(false);
    });
});

describe('run-vitest exit decision', () => {
    it.each([true, false])('fails a timed-out run even with green summary %s', sawGreenSummary => {
        expect(decideExitCode({ sawGreenSummary, timedOut: true, code: 0, signal: null })).toBe(1);
    });
    it('reports success on a green summary even when vitest self-exits non-zero (worker crash)', () => {
        expect(decideExitCode({ sawGreenSummary: true, code: 1, signal: null })).toBe(0);
    });

    it('reports success on a green summary when vitest was force-killed by signal', () => {
        expect(decideExitCode({ sawGreenSummary: true, code: null, signal: 'SIGTERM' })).toBe(0);
    });

    it('propagates a non-zero exit when the summary is not green', () => {
        expect(decideExitCode({ sawGreenSummary: false, code: 1, signal: null })).toBe(1);
    });

    it('passes through a clean zero exit', () => {
        expect(decideExitCode({ sawGreenSummary: false, code: 0, signal: null })).toBe(0);
    });

    it('exits 1 when killed by a signal with no code and tests did not all pass', () => {
        expect(decideExitCode({ sawGreenSummary: false, code: null, signal: 'SIGKILL' })).toBe(1);
    });
});

describe('run-vitest diagnostic configuration', () => {
    it('disables optional timers when absent', () => {
        expect(readOptionalDelay(undefined, 'TIMER')).toBe(0);
    });

    it('accepts positive timer durations', () => {
        expect(readOptionalDelay('2400000', 'TIMER')).toBe(2_400_000);
    });

    it.each(['', '0', '-1', 'NaN', 'Infinity', '1.5', '2147483648'])('rejects invalid delay %j', value => {
        expect(() => readOptionalDelay(value, 'TIMER')).toThrow('TIMER must be a positive timer duration');
    });

    it('selects only the explicitly owned process group, including descendants', () => {
        expect(selectProcessGroupPids([
            '  101  101  0.0 S /opt/node',
            '  102  101 99.9 R /opt/node',
            '  103  101  0.0 S /bin/sh',
            '  201  201  0.0 S /opt/node',
            '  202  201  0.0 S /opt/node',
        ].join('\n'), 101)).toEqual([101, 102, 103]);
        expect(selectProcessGroupPids('', 101)).toEqual([]);
    });
});

describe('run-vitest termination', () => {
    it.skipIf(process.platform === 'win32')('reports failure when the wrapper deadline terminates Vitest', async () => {
        const child = spawn(process.execPath, [
            fileURLToPath(new URL('../../scripts/run-vitest.mjs', import.meta.url)),
            'test/scripts/run-vitest-lib.test.ts',
        ], {
            env: { ...process.env, COC_VITEST_TIMEOUT_MS: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stderr.on('data', chunk => { output += chunk.toString(); });
        const [code] = await once(child, 'close');
        expect(code).toBe(1);
        expect(output).toContain('Test deadline exceeded (1 ms)');
    }, 10_000);

    it('shares one TERM/KILL escalation and cancels its timer on disposal', () => {
        vi.useFakeTimers();
        const kill = vi.fn();
        const terminator = createTestProcessTerminator({ kill }, false, 100);
        try {
            terminator.terminate();
            terminator.terminate();
            expect(kill.mock.calls).toEqual([['SIGTERM']]);
            terminator.dispose();
            vi.advanceTimersByTime(200);
            expect(kill.mock.calls).toEqual([['SIGTERM']]);
        } finally {
            terminator.dispose();
            vi.useRealTimers();
        }
    });

    it.skipIf(process.platform === 'win32')('kills a blocked worker without signalling an unrelated group', async () => {
        const fixture = `
            const { spawn } = require('node:child_process');
            process.on('SIGTERM', () => {});
            const worker = spawn(process.execPath, ['-e', [
                'process.on("SIGTERM", () => {});',
                'process.stdout.write("ready");',
                'setInterval(() => {}, 1000);',
            ].join('')], { stdio: ['ignore', 'pipe', 'inherit'] });
            worker.stdout.once('data', () => process.stdout.write('ready'));
            worker.stdout.pipe(process.stdout);
            setInterval(() => {}, 1000);
        `;
        const child = spawn(process.execPath, ['-e', fixture], {
            detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
        const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
            detached: true, stdio: 'ignore',
        });
        const closed = once(child, 'close');
        const unrelatedClosed = once(unrelated, 'close');
        const terminator = createTestProcessTerminator(child, true, 50);
        const cleanup = createTestProcessTerminator(unrelated, true, 50);
        try {
            await once(child.stdout, 'data');
            terminator.terminate();
            const [, signal] = await closed;
            expect(signal).toBe('SIGKILL');
            expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
        } finally {
            terminator.terminate();
            cleanup.terminate();
            await Promise.all([closed, unrelatedClosed]);
            terminator.dispose();
            cleanup.dispose();
        }
    }, 10_000);
});

describe('run-vitest native samples', () => {
    it.each([false, true])('samples only owned PIDs and surfaces a vanished worker: %s', async vanish => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'vitest-samples-'));
        const log = vi.fn();
        const run = vi.fn(async (command: string, args: string[]) => {
            if (command === 'ps') return { stdout: '101 101 0.0 S node\n102 101 99.9 R node\n201 201 0.0 S node\n' };
            if (vanish && args[0] === '101') throw new Error('process exited');
            await writeFile(args[args.length - 1], `Native stack for ${args[0]}`);
            return { stdout: '' };
        });
        try {
            await captureMacSamples(101, directory, log, run);
            expect(run.mock.calls.filter(([command]) => command === 'sample').map(([, args]) => args[0]))
                .toEqual(['101', '102']);
            expect(run).toHaveBeenCalledWith('sample', [
                '102', '1', '10', '-mayDie', '-file', path.join(directory, 'process-102.sample.txt'),
            ], { timeout: 10_000 });
            expect(log).toHaveBeenCalledWith('Native stack for 102');
            if (vanish) expect(log).toHaveBeenCalledWith('[Vitest diagnostics] Sampling PID 101 failed: process exited');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('propagates process snapshot failure rather than reporting an empty successful capture', async () => {
        const run = vi.fn().mockRejectedValue(new Error('ps failed'));
        await expect(captureMacSamples(101, 'unused', vi.fn(), run)).rejects.toThrow('ps failed');
    });
});
