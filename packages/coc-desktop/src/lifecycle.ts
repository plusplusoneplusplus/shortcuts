/**
 * CoC Desktop — lifecycle helpers (AC-05).
 *
 * Electron-free, unit-testable logic for the desktop lifecycle + UX:
 *
 *   - {@link shutdownServer}: the started-vs-attached drain guard. We only ever
 *     shut down a server WE forked; one we merely attached to (e.g. a CLI
 *     `coc serve`) is left running. For a started server we ask the forked child
 *     to `close({ drain: true })` over IPC and wait for it to exit, force-killing
 *     if the drain overruns so quit can never hang.
 *   - {@link shouldOpenExternally}: external-link routing — decide whether a
 *     navigation target should open in the system browser instead of the app
 *     window (any http(s) URL whose origin differs from the served SPA).
 *   - {@link shouldSurfaceLoadFailure}: fatal-load policy — surface only
 *     non-aborted failures from the main app frame.
 *
 * As with splash.ts / server-controller.ts / agent-preflight.ts, this module
 * imports NOTHING from electron, so it stays runnable under plain node/vitest.
 */

import { ServerHandle } from './server-controller';

/**
 * Outcome of {@link shutdownServer}:
 *   - `noop`     — no server (or no live child) to act on.
 *   - `detached` — attached to an external/CLI server; left running untouched.
 *   - `drained`  — our forked child drained and exited gracefully.
 *   - `killed`   — the child had to be force-killed (drain overran / IPC gone).
 */
export type ShutdownOutcome = 'noop' | 'detached' | 'drained' | 'killed';

/** Injectable timer seams so the drain timeout is deterministic in tests. */
export interface ShutdownDeps {
    /** Grace period before a stuck drain is force-killed (default 10s). */
    timeoutMs?: number;
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Wind down the embedded server on quit, honoring the started-vs-attached guard.
 *
 * Only a server we forked (`handle.started === true`) is shut down: we send the
 * forked child `{ type: 'shutdown', drain: true }`, which makes it call
 * `server.close({ drain: true })` and exit. A server we merely attached to is
 * left alone (`detached`). Resolves once it is safe to quit.
 */
export function shutdownServer(
    handle: ServerHandle | null,
    deps: ShutdownDeps = {},
): Promise<ShutdownOutcome> {
    return new Promise<ShutdownOutcome>((resolve) => {
        // The guard: never shut down a server we didn't start.
        if (!handle) {
            resolve('noop');
            return;
        }
        if (!handle.started) {
            resolve('detached');
            return;
        }

        const child = handle.child;
        if (!child || child.killed) {
            // We started it, but there's no live child left to drain.
            resolve('noop');
            return;
        }

        const timeoutMs = deps.timeoutMs ?? 10_000;
        const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
        const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));

        let settled = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (outcome: ShutdownOutcome) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimer(timer);
            resolve(outcome);
        };

        // The child responds to the shutdown IPC by draining then exiting(0).
        child.once('exit', () => finish('drained'));

        // Force-kill if the graceful drain overruns, so quit never hangs.
        timer = setTimer(() => {
            try {
                child.kill('SIGKILL');
            } catch {
                /* best-effort */
            }
            finish('killed');
        }, timeoutMs);

        try {
            child.send({ type: 'shutdown', drain: true });
        } catch {
            // IPC channel already closed — kill so quit proceeds immediately.
            try {
                child.kill();
            } catch {
                /* best-effort */
            }
            finish('killed');
        }
    });
}

/** Reduce a URL (or bare origin) to its `scheme://host:port` origin string. */
function normalizeOrigin(origin: string): string {
    try {
        return new URL(origin).origin;
    } catch {
        return origin;
    }
}

/**
 * Decide whether a navigation target should open in the system browser rather
 * than inside the app window.
 *
 * Routes to the system browser only genuine external http(s) links — any
 * absolute http/https URL whose origin differs from the served SPA's. Same-origin
 * navigation (the SPA itself, its sub-routes and assets) stays in-window, and
 * non-http(s) schemes (data:, devtools:, about:, mailto:, …) are left to the
 * window's default handling.
 */
export function shouldOpenExternally(targetUrl: string, appOrigin: string): boolean {
    let target: URL;
    try {
        target = new URL(targetUrl);
    } catch {
        return false; // not an absolute URL — let the window handle it
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return false; // only http(s) links route to the system browser
    }
    return target.origin !== normalizeOrigin(appOrigin);
}

/**
 * Decide whether an Electron `did-fail-load` event is fatal to the app UI.
 *
 * Child-frame failures are isolated to their embedded content. Main-frame
 * failures remain fatal except for Electron's aborted-navigation code.
 */
export function shouldSurfaceLoadFailure(
    errorCode: number,
    isMainFrame: boolean,
): boolean {
    return isMainFrame && errorCode !== -3;
}
