/**
 * ScheduleTimerRegistry
 *
 * Owns a key → setTimeout handle map.  Centralizes the cap on setTimeout's
 * 32-bit delay range and provides cancel/clear primitives.
 *
 * Generic over the key type so callers choose their own key discipline.
 * `ScheduleManager` instantiates it as `ScheduleTimerRegistry<ScheduleRuntimeKey>`
 * so a bare schedule ID cannot be passed: repo-defined schedules share
 * deterministic IDs across workspaces, and a bare ID would let one workspace
 * cancel another's timer.  The cron, wakeup, and trigger subsystems key by
 * their own globally unique IDs and use the default `string` key.
 *
 * The registry has no knowledge of cron expressions or schedule entries;
 * callers compute the desired fire time and pass an absolute delay in ms.
 */

const MAX_TIMEOUT = 2147483647;

export class ScheduleTimerRegistry<K extends string = string> {
    private readonly timers = new Map<K, ReturnType<typeof setTimeout>>();

    /**
     * Schedule a callback to fire after `delayMs`.  Caps delays larger than
     * the 32-bit setTimeout maximum (~24.8 days); the caller is expected to
     * detect the cap (via `wasCapped`) and reschedule.
     *
     * Replaces any existing timer for the same key.
     */
    set(key: K, callback: () => void, delayMs: number): { wasCapped: boolean } {
        this.cancel(key);
        const actualDelay = Math.min(Math.max(delayMs, 0), MAX_TIMEOUT);
        const timer = setTimeout(() => {
            this.timers.delete(key);
            callback();
        }, actualDelay);
        this.timers.set(key, timer);
        return { wasCapped: actualDelay < delayMs };
    }

    cancel(key: K): void {
        const timer = this.timers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
    }

    has(key: K): boolean {
        return this.timers.has(key);
    }

    /** Cancel and forget every timer. */
    clear(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
}
