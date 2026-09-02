/**
 * Owns the in-memory run record list together with the optional SQLite
 * persistence backend.  Trims history per schedule and mirrors writes to
 * persistence when configured.
 *
 * History is keyed by `(repoId, scheduleId)` runtime keys, not by bare
 * schedule IDs: repo-defined schedules share deterministic IDs across
 * workspaces, so a bare ID would bleed one workspace's runs into another's.
 */

import type { ScheduleRunRecord } from './schedule-manager-types';
import type { SqliteScheduleRunPersistence } from './sqlite-schedule-run-persistence';
import { scheduleRuntimeKey, type ScheduleRuntimeKey } from './schedule-runtime-key';

const MAX_HISTORY_PER_SCHEDULE = 100;

export class ScheduleRunHistory {
    private readonly runHistory = new Map<ScheduleRuntimeKey, ScheduleRunRecord[]>();
    private persistence: SqliteScheduleRunPersistence | null = null;

    /**
     * Inject persistence and hydrate the in-memory map from disk.
     */
    restore(persistence: SqliteScheduleRunPersistence): number {
        this.persistence = persistence;
        const restored = persistence.loadAll();
        for (const [key, runs] of restored) {
            this.runHistory.set(key, runs);
        }
        return restored.size;
    }

    /** Append a new run to the head of the history list and persist it. */
    add(repoId: string, scheduleId: string, run: ScheduleRunRecord): void {
        const key = scheduleRuntimeKey(repoId, scheduleId);
        let history = this.runHistory.get(key);
        if (!history) {
            history = [];
            this.runHistory.set(key, history);
        }
        history.unshift(run);
        if (history.length > MAX_HISTORY_PER_SCHEDULE) {
            history.pop();
        }
        this.persistRun(run);
    }

    /** Update an existing run record (looked up by id) in place. */
    update(repoId: string, scheduleId: string, run: ScheduleRunRecord): void {
        const history = this.runHistory.get(scheduleRuntimeKey(repoId, scheduleId));
        if (!history) return;
        const idx = history.findIndex(r => r.id === run.id);
        if (idx >= 0) {
            history[idx] = run;
        }
        this.persistRun(run);
    }

    get(repoId: string, scheduleId: string): ScheduleRunRecord[] {
        return this.runHistory.get(scheduleRuntimeKey(repoId, scheduleId)) || [];
    }

    delete(repoId: string, scheduleId: string): void {
        this.runHistory.delete(scheduleRuntimeKey(repoId, scheduleId));
    }

    private persistRun(run: ScheduleRunRecord): void {
        if (!this.persistence) return;
        this.persistence.upsert(run);
        this.persistence.trim(run.repoId);
    }
}
