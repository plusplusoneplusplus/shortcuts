/**
 * Scheduled-wakeup command wiring.
 *
 * A `scheduleWakeup` tool call now creates a **durable** wakeup: the command
 * persists a `WakeupEntry` (status `pending`, absolute `firesAt`) and asks the
 * {@link WakeupExecutor} to arm its one-shot timer. Persisting before arming is
 * what makes wakeups recoverable — a server restart re-arms every pending
 * wakeup from the store (overdue ones fire immediately), instead of silently
 * dropping in-memory timers.
 *
 * The timer is keyed `wakeup:<wakeupId>` in the shared
 * {@link ScheduleTimerRegistry} — deliberately NOT keyed by processId and NOT
 * owned by the per-turn executor session. That decoupling is what lets a wakeup
 * survive turn-end teardown (`BaseExecutor.cleanupSession`, the executor
 * `finally` blocks): the executor never touches this registry, so a wakeup
 * scheduled mid-turn still fires after the turn completes.
 */

import type { WakeupStore } from './wakeup-store';
import type { WakeupExecutor } from './wakeup-executor';
import type { WakeupEntry } from './wakeup-types';

// Re-exported for callers/tests that reference the timer key helpers.
export { WAKEUP_TIMER_KEY_PREFIX, wakeupTimerKey } from './wakeup-executor';

/** Options passed when scheduling a durable wakeup. */
export interface WakeupEnqueueOptions {
    processId: string;
    prompt: string;
    delayMs: number;
    wakeupId: string;
    model?: string;
    workspaceId?: string;
}

export interface EnqueueWakeupDeps {
    store: WakeupStore;
    executor: WakeupExecutor;
    /** Clock injection for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
}

/**
 * Build the `enqueueWakeup` callback handed to the scheduleWakeup tool. The
 * returned function persists a pending wakeup record and arms its one-shot
 * timer. If the timer fires, the executor runs the follow-up and marks the
 * wakeup terminally fired/failed.
 */
export function createEnqueueWakeup(deps: EnqueueWakeupDeps): (opts: WakeupEnqueueOptions) => void {
    const now = deps.now ?? Date.now;
    return (opts: WakeupEnqueueOptions) => {
        const createdMs = now();
        const wakeup: WakeupEntry = {
            id: opts.wakeupId,
            processId: opts.processId,
            prompt: opts.prompt,
            model: opts.model ?? null,
            status: 'pending',
            createdAt: new Date(createdMs).toISOString(),
            firesAt: new Date(createdMs + opts.delayMs).toISOString(),
            firedAt: null,
            failureReason: null,
            ...(opts.workspaceId != null ? { workspaceId: opts.workspaceId } : {}),
        };
        deps.store.insert(wakeup);
        deps.executor.arm(wakeup);
    };
}
