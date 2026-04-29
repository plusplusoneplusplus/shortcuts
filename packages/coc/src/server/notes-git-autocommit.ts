/**
 * Notes Git Auto-Commit — in-process background timer.
 *
 * `NotesAutoCommitTimer` runs `NotesGitService.commit()` on a `setInterval`
 * so auto-commits are silent (no shell scripts, no Activity-tab entries).
 * Calls `.unref()` on the interval so the timer does not block process exit.
 *
 * `NOTES_AUTOCOMMIT_SCHEDULE_NAME` and `findAutoCommitSchedule` are kept for
 * backward-compat cleanup when upgrading from the old scheduler-based approach.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ScheduleManager, ScheduleEntry } from './schedule-manager';
import { NotesGitService } from './notes-git-service';

/** Well-known schedule name used by the old scheduler — kept for migration cleanup. */
export const NOTES_AUTOCOMMIT_SCHEDULE_NAME = 'Notes Auto-Commit';

/**
 * Find a stale auto-commit schedule entry left by the old scheduler-based approach.
 * Used only for one-time backward-compat cleanup on first enable after upgrade.
 */
export function findAutoCommitSchedule(
    scheduleManager: ScheduleManager,
    repoId: string,
): ScheduleEntry | undefined {
    return scheduleManager.getSchedules(repoId)
        .find(s => s.name === NOTES_AUTOCOMMIT_SCHEDULE_NAME);
}

/**
 * In-process background timer that calls `NotesGitService.commit()` at a regular interval.
 *
 * Lifecycle:
 *   1. `new NotesAutoCommitTimer(notesDir, intervalMs)`
 *   2. `start()` — begins firing; calls `.unref()` on the interval.
 *   3. `stop()` — clears the interval.
 *   4. `runOnce()` — can be called manually (e.g. for testing).
 *   5. `getLastResult()` — returns the timestamp of the last successful commit and any error.
 */
export class NotesAutoCommitTimer {
    private timer: ReturnType<typeof setInterval> | null = null;
    private lastCommittedAt: string | null = null;
    private lastError: string | null = null;

    constructor(
        private readonly notesDir: string,
        private readonly intervalMs: number,
    ) {}

    start(): void {
        if (this.timer !== null) return;
        this.timer = setInterval(() => {
            this.runOnce().catch(() => { /* best-effort */ });
        }, this.intervalMs);
        // Don't prevent Node.js from exiting cleanly
        if ((this.timer as any).unref) (this.timer as any).unref();
    }

    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async runOnce(): Promise<void> {
        try {
            const service = new NotesGitService(this.notesDir);
            const timestamp = new Date().toISOString();
            const result = await service.commit(`auto: ${timestamp}`);
            if (result.committed) {
                this.lastCommittedAt = timestamp;
            }
            this.lastError = null;
        } catch (err: any) {
            this.lastError = err?.message ?? String(err);
        }
    }

    getLastResult(): { committedAt: string | null; error: string | null } {
        return { committedAt: this.lastCommittedAt, error: this.lastError };
    }
}
