/**
 * IdleWatchdog — provider-agnostic idle + wall-clock timers for a single turn.
 *
 * One implementation shared by every provider so `idleTimeoutMs` means the same
 * thing everywhere:
 *
 *   - Any provider event is activity: call {@link IdleWatchdog.reset} as the
 *     first statement of the stream loop body, before any event-type branching.
 *   - Suppressed while the agent is provably blocked rather than idle (a
 *     long-running tool such as `ask_user`, or pending background work). On
 *     expiry with suppression active the watchdog reschedules instead of firing.
 *     The wall-clock cap still applies.
 *   - `idleTimeoutMs` of 0/undefined disables the idle timer; `timeoutMs` of
 *     0/undefined (or no `onTimeout`) disables the wall-clock cap.
 *
 * Callers own what happens on fire — typically: log, flag, abort the turn's
 * AbortController, and settle with the idle-timeout error text.
 */

export interface IdleWatchdogOptions {
    /** Idle window in ms. 0/undefined = disabled. */
    idleTimeoutMs?: number;
    /**
     * Evaluated at fire time. When it returns true the watchdog reschedules the
     * idle timer for another full window instead of firing.
     */
    isSuppressed?: () => boolean;
    /** Called when the idle window expires with no activity and no suppression. */
    onIdle: (elapsedMs: number) => void;
    /** Called instead of {@link onIdle} when the fire was suppressed. */
    onSuppressed?: (elapsedMs: number) => void;
    /** Optional wall-clock cap in ms. 0/undefined = disabled. */
    timeoutMs?: number;
    /** Called when the wall-clock cap expires. Required for the cap to arm. */
    onTimeout?: (elapsedMs: number) => void;
}

export class IdleWatchdog {
    private idleTimerId?: ReturnType<typeof setTimeout>;
    private overallTimerId?: ReturnType<typeof setTimeout>;
    private disposed = false;

    constructor(private readonly options: IdleWatchdogOptions) {}

    /** Whether the idle timer is configured (window > 0). */
    get idleEnabled(): boolean {
        const ms = this.options.idleTimeoutMs ?? 0;
        return Number.isFinite(ms) && ms > 0;
    }

    /** Arm the wall-clock cap (if configured) and the idle timer. */
    start(): void {
        if (this.disposed) return;
        const timeoutMs = this.options.timeoutMs ?? 0;
        if (this.options.onTimeout && Number.isFinite(timeoutMs) && timeoutMs > 0) {
            this.overallTimerId = setTimeout(() => {
                this.overallTimerId = undefined;
                this.options.onTimeout!(timeoutMs);
            }, timeoutMs);
        }
        this.reset();
    }

    /** Restart the idle window. Call on every provider event. */
    reset(): void {
        if (this.disposed || !this.idleEnabled) return;
        const idleMs = this.options.idleTimeoutMs!;
        if (this.idleTimerId !== undefined) clearTimeout(this.idleTimerId);
        this.idleTimerId = setTimeout(() => {
            this.idleTimerId = undefined;
            if (this.disposed) return;
            if (this.options.isSuppressed?.()) {
                this.options.onSuppressed?.(idleMs);
                this.reset();
                return;
            }
            this.options.onIdle(idleMs);
        }, idleMs);
    }

    /** Clear every timer. Idempotent; safe to call from a `finally`. */
    dispose(): void {
        this.disposed = true;
        if (this.idleTimerId !== undefined) {
            clearTimeout(this.idleTimerId);
            this.idleTimerId = undefined;
        }
        if (this.overallTimerId !== undefined) {
            clearTimeout(this.overallTimerId);
            this.overallTimerId = undefined;
        }
    }
}

/** The single error text every provider settles with on an idle kill. */
export function idleTimeoutErrorMessage(idleTimeoutMs: number): string {
    return `Request idle-timed out after ${idleTimeoutMs}ms with no activity`;
}
