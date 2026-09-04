/**
 * SessionTimerManager — owns all timer types for a streaming session.
 *
 * Timer types:
 *   - overall timeout (wall-clock)
 *   - idle timeout (resets on activity)
 *   - turn-end grace timer (2s after turn_end, cancelled by turn_start)
 *
 * The wall-clock and idle timers are delegated to the shared {@link IdleWatchdog}
 * so Copilot and the other providers run the exact same idle semantics; the
 * turn-end grace timer has no analogue elsewhere and stays here.
 *
 * All timers fire callbacks provided by the caller (the orchestrator).
 * No direct state machine or SDK interaction.
 */

import { IdleWatchdog } from './idle-watchdog';

export interface SessionTimerCallbacks {
    /** Called when the overall wall-clock timeout fires. */
    onTimeout: () => void;
    /** Called when the idle timeout fires (no activity within window). */
    onIdleTimeout: () => void;
    /** Called when the turn-end grace period expires without a new turn_start. */
    onTurnEndGrace: () => void;
    /**
     * Optional: whether the idle timeout should be suppressed at fire time
     * (e.g. tool calls in flight). When it returns true the idle window is
     * rescheduled and `onIdleTimeout` is not called.
     */
    isIdleSuppressed?: () => boolean;
    /** Optional: called instead of `onIdleTimeout` when a fire was suppressed. */
    onIdleSuppressed?: (elapsedMs: number) => void;
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
    private readonly watchdog: IdleWatchdog;
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
        this.watchdog = new IdleWatchdog({
            timeoutMs: this.config.timeoutMs,
            onTimeout: () => this.callbacks.onTimeout(),
            idleTimeoutMs: this.config.idleTimeoutMs,
            isSuppressed: callbacks.isIdleSuppressed,
            onSuppressed: callbacks.onIdleSuppressed,
            onIdle: () => this.callbacks.onIdleTimeout(),
        });
    }

    /** Whether a turn-end grace timer is currently active. */
    get hasTurnEndGraceTimer(): boolean {
        return this._turnEndGraceTimer !== null;
    }

    /** Start the overall and idle timers. Call once after session starts. */
    start(): void {
        this.watchdog.start();
    }

    /** Reset the idle timer (call on every activity event). */
    resetIdleTimer(): void {
        this.watchdog.reset();
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
        this.watchdog.dispose();
        this.cancelTurnEndGrace();
    }
}
