/**
 * PeriodicEntryScheduler
 *
 * Shared timer-arming lifecycle kernel for persisted periodic work. Loops and
 * triggers are both long-lived background automation surfaces that drive off the
 * same contract: load active entries, compute a `nextTickAt` delay, clamp overdue
 * entries to immediate execution, register with `ScheduleTimerRegistry`, disarm
 * individual timers, clear all timers on shutdown, and re-arm after persisting the
 * next tick. Centralizing that policy here keeps missed-run, overdue-run,
 * shutdown, and restart behavior identical across the two features.
 *
 * Domain-specific concerns — tick execution, status transitions, expiration, and
 * store semantics — stay in `LoopExecutor` / `TriggerManager`. This kernel owns
 * only the timer mechanics and the arm-after-persist ordering.
 */

import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { ScheduleTimerRegistry } from './schedule-timer-registry';

/** Minimal contract every periodic entry must satisfy to be scheduled. */
export interface PeriodicEntry {
    /** Stable timer key. */
    id: string;
    /** Lifecycle status; only `'active'` entries are armed by default. */
    status: string;
    /** ISO timestamp of the next scheduled tick, or `null` when not scheduled. */
    nextTickAt: string | null;
}

export interface PeriodicEntrySchedulerDeps<TEntry extends PeriodicEntry> {
    /** Timer registry the scheduler arms/cancels/clears against. */
    timerRegistry: ScheduleTimerRegistry;
    /**
     * Fallback delay (ms) when an entry has no usable `nextTickAt` (fresh arm or
     * a corrupt timestamp). Loops use their fixed interval; triggers use the
     * event's poll cadence.
     */
    getFallbackIntervalMs: (entry: TEntry) => number;
    /** Persist an entry after its `nextTickAt` is advanced (e.g. `store.update`). */
    persist: (entry: TEntry) => void;
    /**
     * Domain tick handler fired when a timer elapses. May be async; the returned
     * promise is passed through to the timer callback (fire-and-forget in
     * production, awaitable in tests) rather than floated inside the kernel.
     */
    onTick: (id: string) => void | Promise<void>;
    /** Label used in lifecycle log lines (e.g. `LoopExecutor`). */
    logLabel: string;
    /** Clock injection for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
    /**
     * Optional domain cleanup run during `shutdownAll` after timers are cleared
     * (e.g. `LoopExecutor` clears its in-flight set).
     */
    onShutdownCleanup?: () => void;
    /**
     * Predicate deciding whether an entry should be armed. Defaults to
     * `entry.status === 'active'`.
     */
    isActive?: (entry: TEntry) => boolean;
}

export class PeriodicEntryScheduler<TEntry extends PeriodicEntry> {
    private readonly deps: PeriodicEntrySchedulerDeps<TEntry>;
    private readonly now: () => number;
    private readonly isActive: (entry: TEntry) => boolean;

    constructor(deps: PeriodicEntrySchedulerDeps<TEntry>) {
        this.deps = deps;
        this.now = deps.now ?? Date.now;
        this.isActive = deps.isActive ?? (entry => entry.status === 'active');
    }

    /**
     * Compute the arm delay (ms) for an entry: the time remaining until
     * `nextTickAt` (clamped to `0` for overdue values), or the fallback interval
     * when `nextTickAt` is absent or an invalid timestamp. Pure — reads only the
     * injected clock.
     */
    delayFor(entry: TEntry): number {
        if (entry.nextTickAt) {
            const target = new Date(entry.nextTickAt).getTime();
            if (Number.isNaN(target)) return this.deps.getFallbackIntervalMs(entry);
            const delayMs = target - this.now();
            return delayMs < 0 ? 0 : delayMs; // overdue — fire immediately
        }
        return this.deps.getFallbackIntervalMs(entry);
    }

    /** Arm the timer for a single active entry (no-op for inactive entries). */
    arm(entry: TEntry): void {
        if (!this.isActive(entry)) return;
        const { id } = entry;
        this.deps.timerRegistry.set(id, () => this.deps.onTick(id), this.delayFor(entry));
    }

    /**
     * Arm every entry (inactive ones are skipped) and log a startup summary.
     * Callers pass their active set (e.g. `store.getActive()`).
     */
    armAll(entries: TEntry[]): void {
        for (const entry of entries) this.arm(entry);
        getLogger().info(LogCategory.AI, `[${this.deps.logLabel}] Armed ${entries.length} active entry(s)`);
    }

    /** Cancel the timer for a single entry (does not mutate persisted state). */
    disarm(id: string): void {
        this.deps.timerRegistry.cancel(id);
    }

    /**
     * Advance `nextTickAt` by the fallback interval, persist, then re-arm —
     * preserving the arm-after-persist ordering both features rely on so a
     * restart re-arms from the freshly persisted timestamp.
     */
    reschedule(entry: TEntry): void {
        entry.nextTickAt = new Date(this.now() + this.deps.getFallbackIntervalMs(entry)).toISOString();
        this.deps.persist(entry);
        this.arm(entry);
    }

    /**
     * Clear every timer during shutdown without mutating persisted state, run
     * optional domain cleanup, then log. Active entries re-arm on next startup.
     */
    shutdownAll(): void {
        this.deps.timerRegistry.clear();
        this.deps.onShutdownCleanup?.();
        getLogger().info(LogCategory.AI, `[${this.deps.logLabel}] Disarmed active timer(s) for shutdown`);
    }
}
