/**
 * Pure helpers for run-vitest.mjs, extracted so the exit-decision logic is
 * unit-testable without spawning vitest.
 */

/**
 * Matches vitest's final "Test Files" summary line only when every test file
 * passed — i.e. "passed" is present and "failed" is absent on that line. Real
 * test failures render as "Test Files  N failed | M passed", which this
 * intentionally does NOT match.
 */
export const GREEN_SUMMARY_RE = /^\s*Test Files\s+(?!.*\bfailed\b)(?=.*\bpassed\b).*/m;

export function matchesGreenSummary(text) {
    return GREEN_SUMMARY_RE.test(text);
}

/**
 * Decide the wrapper's exit code once the vitest child process closes.
 *
 * A green summary means every test file passed. vitest can still exit non-zero
 * purely because of tolerated worker-crash "unhandled errors" — most notably
 * the flaky libuv `fs.watch` assertion on Windows
 * (`Assertion failed: !_wcsnicmp(filename, dir, dirlen)`), which aborts a
 * worker fork after its tests already passed. In that case the wrapper must
 * still report success. This is decided purely on `sawGreenSummary`, so it does
 * not depend on whether our grace timer force-killed vitest first or vitest
 * self-exited — closing the race that previously let those crashes fail CI.
 *
 * Runs where a test file actually failed never produce a green summary, so
 * their non-zero exit is preserved.
 *
 * @param {{ sawGreenSummary: boolean, code: number | null, signal: string | null }} params
 * @returns {number} exit code for the wrapper process
 */
export function decideExitCode({ sawGreenSummary, code, signal }) {
    if (sawGreenSummary) return 0;
    if (typeof code === 'number') return code;
    // Closed on a signal with no numeric code, and tests did not all pass.
    return 1;
}
