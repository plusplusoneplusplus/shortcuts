/**
 * ScheduleRunHistory
 *
 * Owns the in-memory scheduleId → run record list together with the
 * optional SQLite persistence backend.  Trims history per schedule and
 * mirrors writes to persistence when configured.
 */

import type { ScheduleRunRecord } from './schedule-manager-types';
import type { SqliteScheduleRunPersistence } from './sqlite-schedule-run-persistence';

const MAX_HISTORY_PER_SCHEDULE = 100;

export class ScheduleRunHistory {
    private readonly runHistory = new Map<string, ScheduleRunRecord[]>();
    private persistence: SqliteScheduleRunPersistence | null = null;

    /**
     * Inject persistence and hydrate the in-memory map from disk.
     */
    restore(persistence: SqliteScheduleRunPersistence): number {
        this.persistence = persistence;
        const restored = persistence.loadAll();
        for (const [scheduleId, runs] of restored) {
            this.runHistory.set(scheduleId, runs);
        }
        return restored.size;
    }

    /** Append a new run to the head of the history list and persist it. */
    add(scheduleId: string, run: ScheduleRunRecord): void {
        let history = this.runHistory.get(scheduleId);
        if (!history) {
            history = [];
            this.runHistory.set(scheduleId, history);
        }
        history.unshift(run);
        if (history.length > MAX_HISTORY_PER_SCHEDULE) {
            history.pop();
        }
        this.persistRun(run);
    }

    /** Update an existing run record (looked up by id) in place. */
    update(scheduleId: string, run: ScheduleRunRecord): void {
        const history = this.runHistory.get(scheduleId);
        if (!history) return;
        const idx = history.findIndex(r => r.id === run.id);
        if (idx >= 0) {
            history[idx] = run;
        }
        this.persistRun(run);
    }

    get(scheduleId: string): ScheduleRunRecord[] {
        return this.runHistory.get(scheduleId) || [];
    }

    delete(scheduleId: string): void {
        this.runHistory.delete(scheduleId);
    }

    private persistRun(run: ScheduleRunRecord): void {
        if (!this.persistence) return;
        this.persistence.upsert(run);
        this.persistence.trim(run.repoId);
    }
}
