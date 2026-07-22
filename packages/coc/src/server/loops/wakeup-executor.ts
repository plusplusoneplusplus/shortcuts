/**
 * Wakeup Executor
 *
 * Owns the one-shot lifecycle of durable wakeups:
 * - Arms a single timer per pending wakeup via `ScheduleTimerRegistry`, keyed
 *   `wakeup:<id>` so it survives per-turn executor teardown (the executor never
 *   touches this registry).
 * - Re-arms all pending wakeups at startup; overdue ones fire immediately.
 * - On fire: resolves the follow-up mode and runs a wakeup-sourced follow-up
 *   turn, then marks the wakeup terminally `fired` or `failed` and persists a
 *   failure reason. Wakeups never recur.
 * - Structured logging + optional event emission for observability.
 *
 * Shares only timer/store primitives with loops — no recurrence or
 * failure-count policy.
 */

import type { ProcessStore, TurnSource } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { ChatMode } from '../tasks/task-types';
import type { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';
import { resolveFollowUpMode } from '../executors/follow-up-mode';
import type { WakeupStore } from './wakeup-store';
import type { WakeupEntry, WakeupChangeEvent } from './wakeup-types';

// ============================================================================
// Timer key
// ============================================================================

/** Timer-registry key prefix for one-shot scheduled wakeups. */
export const WAKEUP_TIMER_KEY_PREFIX = 'wakeup:';

/** The {@link ScheduleTimerRegistry} key under which a wakeup's timer is armed. */
export function wakeupTimerKey(wakeupId: string): string {
    return `${WAKEUP_TIMER_KEY_PREFIX}${wakeupId}`;
}

// ============================================================================
// Types
// ============================================================================

export type WakeupEventEmit = (event: WakeupChangeEvent) => void;

/**
 * Minimal follow-up runner the wakeup timer invokes when it fires. Matches the
 * leading arguments of the queue bridge's `executeFollowUp`.
 */
export type WakeupExecuteFollowUp = (
    processId: string,
    message: string,
    attachments: undefined,
    mode: ChatMode,
    deliveryMode: undefined,
    images: undefined,
    selectedSkillNames: undefined,
    model: string | undefined,
    turnSource: TurnSource,
) => Promise<void>;

export interface WakeupExecutorDeps {
    store: WakeupStore;
    processStore: ProcessStore;
    timerRegistry: ScheduleTimerRegistry;
    executeFollowUp: WakeupExecuteFollowUp;
    /** Optional emitter for broadcasting wakeup state changes. */
    emit?: WakeupEventEmit;
    /** Clock injection for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
}

// ============================================================================
// WakeupExecutor
// ============================================================================

export class WakeupExecutor {
    private readonly deps: WakeupExecutorDeps;
    private readonly now: () => number;

    constructor(deps: WakeupExecutorDeps) {
        this.deps = deps;
        this.now = deps.now ?? Date.now;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Arm timers for all pending wakeups. Called once at server startup after
     * the store is opened. Overdue wakeups (`firesAt` in the past) are armed
     * with a zero delay so they fire immediately on the next tick.
     */
    armAll(): void {
        const pending = this.deps.store.getPending();
        let overdue = 0;
        for (const wakeup of pending) {
            if (this.delayFor(wakeup) <= 0) overdue++;
            this.arm(wakeup);
        }
        if (pending.length > 0) {
            getLogger().info(
                LogCategory.AI,
                `[WakeupExecutor] Armed ${pending.length} pending wakeup(s)` +
                (overdue > 0 ? `, ${overdue} overdue (firing immediately)` : ''),
            );
        }
    }

    /**
     * Arm the timer for a single pending wakeup. No-op for terminal wakeups.
     * The delay is `firesAt - now`, clamped to `0` for overdue values.
     */
    arm(wakeup: WakeupEntry): void {
        if (wakeup.status !== 'pending') return;
        this.deps.timerRegistry.set(
            wakeupTimerKey(wakeup.id),
            () => { void this.fire(wakeup.id); },
            this.delayFor(wakeup),
        );
    }

    /** Cancel a wakeup's timer without mutating persisted state. */
    disarm(wakeupId: string): void {
        this.deps.timerRegistry.cancel(wakeupTimerKey(wakeupId));
    }

    /**
     * Cancel a pending wakeup: disarm its timer and mark it terminally
     * cancelled. Returns false if the wakeup is missing or already terminal.
     */
    cancel(wakeupId: string): boolean {
        this.disarm(wakeupId);
        const cancelled = this.deps.store.cancel(wakeupId);
        if (cancelled) {
            const wakeup = this.deps.store.getById(wakeupId);
            if (wakeup) this.emit({ type: 'wakeup-cancelled', wakeup });
        }
        return cancelled;
    }

    /**
     * Disarm pending wakeup timers during shutdown without mutating persisted
     * state. Pending wakeups are re-armed on the next startup.
     */
    shutdownAll(): void {
        for (const wakeup of this.deps.store.getPending()) {
            this.disarm(wakeup.id);
        }
    }

    // ========================================================================
    // Internal
    // ========================================================================

    /**
     * Compute the arm delay (ms): time remaining until `firesAt`, clamped to
     * `0` for overdue (or unparseable) values. Pure — reads only the clock.
     */
    private delayFor(wakeup: WakeupEntry): number {
        const target = new Date(wakeup.firesAt).getTime();
        if (Number.isNaN(target)) return 0;
        const delayMs = target - this.now();
        return delayMs < 0 ? 0 : delayMs;
    }

    /**
     * Fired by the timer registry when a wakeup's delay elapses. Runs the
     * follow-up and marks the wakeup terminally fired/failed.
     */
    private async fire(wakeupId: string): Promise<void> {
        const logger = getLogger();
        const wakeup = this.deps.store.getById(wakeupId);

        if (!wakeup) {
            logger.warn(LogCategory.AI, `[WakeupExecutor] Fire for unknown wakeup ${wakeupId}`);
            return;
        }
        if (wakeup.status !== 'pending') {
            logger.debug(LogCategory.AI, `[WakeupExecutor] Skipping fire for non-pending wakeup ${wakeupId} (status: ${wakeup.status})`);
            return;
        }

        const turnSource: TurnSource = { source: 'wakeup', wakeupId };
        try {
            const mode = await resolveFollowUpMode(this.deps.processStore, wakeup.processId);
            await this.deps.executeFollowUp(
                wakeup.processId,
                wakeup.prompt,
                undefined,
                mode,
                undefined,
                undefined,
                undefined,
                wakeup.model ?? undefined,
                turnSource,
            );
            this.deps.store.markFired(wakeupId, new Date(this.now()).toISOString());
            const fired = this.deps.store.getById(wakeupId);
            if (fired) this.emit({ type: 'wakeup-fired', wakeup: fired });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.deps.store.markFailed(wakeupId, msg, new Date(this.now()).toISOString());
            logger.error(LogCategory.AI, `[WakeupExecutor] Failed to execute wakeup ${wakeupId}: ${msg}`);
            const failed = this.deps.store.getById(wakeupId);
            if (failed) this.emit({ type: 'wakeup-failed', wakeup: failed });
        }
    }

    private emit(event: WakeupChangeEvent): void {
        if (!this.deps.emit) return;
        try {
            this.deps.emit(event);
        } catch {
            // Best-effort broadcast — never fail firing on a bad listener.
        }
    }
}
