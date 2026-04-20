/**
 * SessionTimerManager — owns all timer types for a streaming session.
 *
 * Timer types:
 *   - overall timeout (wall-clock)
 *   - idle timeout (resets on activity)
 *   - turn-end grace timer (2s after turn_end, cancelled by turn_start)
 *   - background drain timeout (safety net when session.idle never arrives)
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
    /** Called when background tasks drain timeout fires (session.idle never arrived). */
    onBackgroundDrainTimeout?: () => void;
}

export interface SessionTimerConfig {
    /** Wall-clock timeout in ms. */
    timeoutMs: number;
    /** Idle timeout in ms. 0 or undefined = disabled. */
    idleTimeoutMs?: number;
    /** Turn-end grace period in ms. Default: 2000. */
    turnEndGraceMs?: number;
    /**
     * Max time to wait for session.idle after background_tasks_changed.
     * If session.idle doesn't arrive within this window, fire
     * onBackgroundDrainTimeout so the session can force-settle.
     * Default: 120_000 (2 minutes). 0 = disabled.
     */
    backgroundDrainTimeoutMs?: number;
}

const DEFAULT_TURN_END_GRACE_MS = 2000;
const DEFAULT_BACKGROUND_DRAIN_TIMEOUT_MS = 120_000;

export class SessionTimerManager {
    private timeoutId?: ReturnType<typeof setTimeout>;
    private idleTimerId?: ReturnType<typeof setTimeout>;
    private _turnEndGraceTimer: ReturnType<typeof setTimeout> | null = null;
    private _backgroundDrainTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly callbacks: SessionTimerCallbacks;
    private readonly config: Required<SessionTimerConfig>;

    constructor(config: SessionTimerConfig, callbacks: SessionTimerCallbacks) {
        this.callbacks = callbacks;
        this.config = {
            timeoutMs: config.timeoutMs,
            idleTimeoutMs: config.idleTimeoutMs ?? 0,
            turnEndGraceMs: config.turnEndGraceMs ?? DEFAULT_TURN_END_GRACE_MS,
            backgroundDrainTimeoutMs: config.backgroundDrainTimeoutMs ?? DEFAULT_BACKGROUND_DRAIN_TIMEOUT_MS,
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

    /**
     * Start the background drain timeout. Called when background_tasks_changed
     * signals active tasks. If session.idle doesn't arrive within the window,
     * fires onBackgroundDrainTimeout so the orchestrator can force-settle.
     * No-op if already active or disabled (0ms).
     */
    startBackgroundDrainTimeout(): void {
        if (this._backgroundDrainTimer) { return; }
        const drainMs = this.config.backgroundDrainTimeoutMs;
        if (drainMs <= 0) { return; }
        this._backgroundDrainTimer = setTimeout(() => {
            this._backgroundDrainTimer = null;
            this.callbacks.onBackgroundDrainTimeout?.();
        }, drainMs);
    }

    /** Cancel the background drain timeout (call on session.idle or settlement). */
    cancelBackgroundDrainTimeout(): void {
        if (this._backgroundDrainTimer) {
            clearTimeout(this._backgroundDrainTimer);
            this._backgroundDrainTimer = null;
        }
    }

    /** Clear all timers. Call on settlement or cancellation. */
    cleanup(): void {
        clearTimeout(this.timeoutId);
        if (this.idleTimerId !== undefined) {
            clearTimeout(this.idleTimerId);
        }
        this.cancelTurnEndGrace();
        this.cancelBackgroundDrainTimeout();
    }
}
