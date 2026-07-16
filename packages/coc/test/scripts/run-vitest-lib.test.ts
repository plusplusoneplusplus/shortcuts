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

import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs helper, no type declarations
import { matchesGreenSummary, decideExitCode } from '../../scripts/run-vitest-lib.mjs';

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
});

describe('run-vitest exit decision', () => {
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
