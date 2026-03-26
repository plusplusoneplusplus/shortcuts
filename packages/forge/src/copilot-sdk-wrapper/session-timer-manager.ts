/**
 * SessionTimerManager — owns all timer types for a streaming session.
 *
 * Timer types:
 *   - overall timeout (wall-clock)
 *   - idle timeout (resets on activity)
 *   - turn-end grace timer (2s after turn_end, cancelled by turn_start)
 *
 * All timers fire callbacks provided by the caller (the orchestrator).
 * No direct state machine or SDK interaction.
 */

export interface SessionTimerCallbacks {
    /** Called when the overall wall-clock timeout fires. */
    onTimeout: () => void;
    /** Called when the idle timeout fires (no activity within window). */
    onIdleTimeout: () => void;
    /** Called when the turn-end grace period expires without a new turn_start. */
    onTurnEndGrace: () => void;
}

export interface SessionTimerConfig {
    /** Wall-clock timeout in ms. */
    timeoutMs: number;
    /** Idle timeout in ms. 0 or undefined = disabled. */
    idleTimeoutMs?: number;
    /** Turn-end grace period in ms. Default: 2000. */
    turnEndGraceMs?: number;
}

const DEFAULT_TURN_END_GRACE_MS = 2000;

export class SessionTimerManager {
    private timeoutId?: ReturnType<typeof setTimeout>;
    private idleTimerId?: ReturnType<typeof setTimeout>;
    private _turnEndGraceTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly callbacks: SessionTimerCallbacks;
    private readonly config: Required<SessionTimerConfig>;

    constructor(config: SessionTimerConfig, callbacks: SessionTimerCallbacks) {
        this.callbacks = callbacks;
        this.config = {
            timeoutMs: config.timeoutMs,
            idleTimeoutMs: config.idleTimeoutMs ?? 0,
            turnEndGraceMs: config.turnEndGraceMs ?? DEFAULT_TURN_END_GRACE_MS,
        };
    }

    /** Whether a turn-end grace timer is currently active. */
    get hasTurnEndGraceTimer(): boolean {
        return this._turnEndGraceTimer !== null;
    }

    /** Start the overall and idle timers. Call once after session starts. */
    start(): void {
        this.timeoutId = setTimeout(() => {
            this.callbacks.onTimeout();
        }, this.config.timeoutMs);

        this.resetIdleTimer();
    }

    /** Reset the idle timer (call on every activity event). */
    resetIdleTimer(): void {
        const effectiveIdleMs = this.config.idleTimeoutMs;
        if (effectiveIdleMs <= 0) { return; }
        if (this.idleTimerId !== undefined) { clearTimeout(this.idleTimerId); }
        this.idleTimerId = setTimeout(() => {
            this.callbacks.onIdleTimeout();
        }, effectiveIdleMs);
    }

    /** Start the turn-end grace timer (call on turn_end). No-op if already active. */
    startTurnEndGrace(): void {
        if (this._turnEndGraceTimer) { return; }
        this._turnEndGraceTimer = setTimeout(() => {
            this._turnEndGraceTimer = null;
            this.callbacks.onTurnEndGrace();
        }, this.config.turnEndGraceMs);
    }

    /** Cancel the turn-end grace timer (call on turn_start). */
    cancelTurnEndGrace(): void {
        if (this._turnEndGraceTimer) {
            clearTimeout(this._turnEndGraceTimer);
            this._turnEndGraceTimer = null;
        }
    }

    /** Clear all timers. Call on settlement or cancellation. */
    cleanup(): void {
        clearTimeout(this.timeoutId);
        if (this.idleTimerId !== undefined) {
            clearTimeout(this.idleTimerId);
        }
        this.cancelTurnEndGrace();
    }
}
