/**
 * CoC Desktop — process elevation detection.
 *
 * Answers "was this app launched with administrator (Windows) / root (POSIX)
 * privileges?" so the answer can be surfaced in the About panel and the Windows
 * Help menu. Running elevated changes what the forked CoC server can touch on
 * disk and which agent CLIs behave differently, so it is worth showing.
 *
 * Kept electron-free (and with the OS probe injectable) so every branch is
 * unit-testable under plain Node on any platform. `main.ts` calls
 * `detectElevation()` once at bootstrap and passes the result into the pure
 * About/menu builders.
 */

/** Whether the current process runs elevated, unelevated, or we could not tell. */
export type ElevationState = 'elevated' | 'standard' | 'unknown';

/** Result of the OS probe: the exit status, or `null` when it could not run. */
export interface ElevationProbeResult {
    status: number | null;
}

/** Injectable seams so tests never spawn a process or depend on the real uid. */
export interface ElevationDeps {
    /**
     * Runs the Windows admin probe and reports its exit status. `null` means the
     * probe itself failed to run (missing binary, spawn error) — that is
     * "unknown", not "standard".
     */
    runWindowsProbe: () => ElevationProbeResult;
    /** POSIX effective uid, or `undefined` where `process.geteuid` is missing. */
    geteuid: (() => number) | undefined;
}

/**
 * Default Windows probe: `fltmc.exe` with no arguments. It enumerates filesystem
 * filter drivers, which requires an elevated token, so it exits 0 only when the
 * process is running as administrator and non-zero (access denied) otherwise.
 * It is present on every supported Windows install, needs no arguments, and —
 * unlike `net session` — does not depend on the Server service being started.
 */
function runFltmcProbe(): ElevationProbeResult {
    try {
        // Required lazily so importing this module stays cheap and side-effect free.
        const { execFileSync } = require('child_process') as typeof import('child_process');
        const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
        execFileSync(`${systemRoot}\\System32\\fltmc.exe`, [], {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 5000,
        });
        return { status: 0 };
    } catch (err) {
        // execFileSync throws on any non-zero exit; `status` distinguishes a real
        // "access denied" exit (a number) from a spawn failure (null/undefined).
        const status = (err as { status?: number | null })?.status;
        return { status: typeof status === 'number' ? status : null };
    }
}

const defaultDeps: ElevationDeps = {
    runWindowsProbe: runFltmcProbe,
    geteuid: typeof process.geteuid === 'function' ? process.geteuid.bind(process) : undefined,
};

/**
 * Detect whether the process is elevated.
 *
 *   - win32: run the admin-only probe — exit 0 is elevated, a non-zero exit is a
 *     standard token, and a probe that could not run at all is unknown.
 *   - everything else: effective uid 0 is root; any other uid is standard. When
 *     `geteuid` is unavailable the answer is unknown.
 *
 * Never throws: a broken probe degrades to `'unknown'` so bootstrap can't fail
 * over a cosmetic status line.
 */
export function detectElevation(
    platform: NodeJS.Platform = process.platform,
    deps: Partial<ElevationDeps> = {},
): ElevationState {
    const { runWindowsProbe, geteuid } = { ...defaultDeps, ...deps };
    try {
        if (platform === 'win32') {
            const { status } = runWindowsProbe();
            if (status === null || status === undefined) {
                return 'unknown';
            }
            return status === 0 ? 'elevated' : 'standard';
        }
        if (!geteuid) {
            return 'unknown';
        }
        return geteuid() === 0 ? 'elevated' : 'standard';
    } catch {
        return 'unknown';
    }
}

/** Human-readable elevation wording, per platform (Administrator vs root). */
export function elevationText(platform: NodeJS.Platform, state: ElevationState): string {
    if (state === 'unknown') {
        return 'Unknown';
    }
    if (platform === 'win32') {
        return state === 'elevated' ? 'Administrator' : 'Standard user';
    }
    return state === 'elevated' ? 'Root' : 'Standard user';
}

/** Label for the disabled status row in the Windows Help menu. */
export function elevationStatusLabel(platform: NodeJS.Platform, state: ElevationState): string {
    return `Elevation: ${elevationText(platform, state)}`;
}

/**
 * The elevation line for the About panel, or `undefined` when it should be
 * omitted. On Windows the status always shows (both answers are useful there,
 * since the app can be started either way from the shell). Elsewhere it only
 * shows when actually running as root — the notable, unusual case. `'unknown'`
 * is never rendered in the About panel; the menu row carries that case.
 */
export function elevationAboutLine(
    platform: NodeJS.Platform,
    state: ElevationState,
): string | undefined {
    if (state === 'unknown') {
        return undefined;
    }
    if (platform === 'win32') {
        return `Running as ${elevationText(platform, state).toLowerCase()}`;
    }
    return state === 'elevated' ? 'Running as root' : undefined;
}
