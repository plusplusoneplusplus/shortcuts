/**
 * CoC Desktop — opt-in server start delay (test seam).
 *
 * The Windows startup smoke test (`test/e2e/desktop-startup.e2e.test.ts`) sets
 * {@link SERVER_START_DELAY_ENV} on the Electron process; the forked
 * `server-entry` inherits it and waits that long before booting the server, so
 * readiness lands deterministically past 30s but inside the controller's
 * 120s allowance. Unset (every real launch) → no delay, startup unchanged.
 */

export const SERVER_START_DELAY_ENV = 'COC_DESKTOP_TEST_SERVER_START_DELAY_MS';

/** Upper bound so a typo can never park the server indefinitely. */
const MAX_DELAY_MS = 600_000;

/** The requested delay in ms; 0 for unset or anything but an integer in (0, 10min]. */
export function readServerStartDelayMs(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env[SERVER_START_DELAY_ENV]?.trim();
    if (!raw || !/^\d+$/.test(raw)) {
        return 0;
    }
    const ms = Number(raw);
    return ms > 0 && ms <= MAX_DELAY_MS ? ms : 0;
}

/** Wait out the requested delay, announcing it first so the wait is visible in logs. */
export async function applyServerStartDelay(
    env: NodeJS.ProcessEnv = process.env,
    log: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<number> {
    const ms = readServerStartDelayMs(env);
    if (ms > 0) {
        log(`[coc-desktop] server-entry pid=${process.pid} delaying startup ${ms}ms (${SERVER_START_DELAY_ENV})`);
        await sleep(ms);
    }
    return ms;
}
