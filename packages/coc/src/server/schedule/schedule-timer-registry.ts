/**
 * ScheduleTimerRegistry
 *
 * Owns the scheduleId → setTimeout handle map.  Centralizes the cap on
 * setTimeout's 32-bit delay range and provides cancel/clear primitives.
 *
 * The registry has no knowledge of cron expressions or schedule entries;
 * callers compute the desired fire time and pass an absolute delay in ms.
 */

const MAX_TIMEOUT = 2147483647;

export class ScheduleTimerRegistry {
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * Schedule a callback to fire after `delayMs`.  Caps delays larger than
     * the 32-bit setTimeout maximum (~24.8 days); the caller is expected to
     * detect the cap (via `wasCapped`) and reschedule.
     *
     * Replaces any existing timer for the same scheduleId.
     */
    set(scheduleId: string, callback: () => void, delayMs: number): { wasCapped: boolean } {
        this.cancel(scheduleId);
        const actualDelay = Math.min(Math.max(delayMs, 0), MAX_TIMEOUT);
        const timer = setTimeout(() => {
            this.timers.delete(scheduleId);
            callback();
        }, actualDelay);
        this.timers.set(scheduleId, timer);
        return { wasCapped: actualDelay < delayMs };
    }

    cancel(scheduleId: string): void {
        const timer = this.timers.get(scheduleId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(scheduleId);
        }
    }

    has(scheduleId: string): boolean {
        return this.timers.has(scheduleId);
    }

    /** Cancel and forget every timer. */
    clear(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
}
