/**
 * ScheduleSnapshotRepository
 *
 * Owns schedule-specific export/import/wipe behavior for the admin storage
 * snapshot: per-repo `schedules/*.yaml` files on disk plus `schedule_runs`
 * rows in the SQLite process store. Kept next to schedule persistence so
 * schedule schema changes stay paired with their backup/restore behavior.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { ScheduleSnapshot } from '../storage/export-import-types';
import { getRepoDataPath } from '../paths';
import {
    getErrorMessage,
    isDirectory,
    listRepoDirs,
    readRepoRootPathFromQueueFile,
    skippedWarning,
    writeYamlFileAtomic,
} from '../storage/snapshot/snapshot-fs';

/** Plan describing schedule YAML files and directories a wipe would remove. */
export interface ScheduleWipePlan {
    scheduleFiles: string[];
    scheduleDirs: string[];
}

export class ScheduleSnapshotRepository {
    collect(dataDir: string, store: ProcessStore): { snapshots: ScheduleSnapshot[]; warnings: string[] } {
        const warnings: string[] = [];
        const runsByRepo = this.readScheduleRunsByRepo(store);
        const repoDirs = listRepoDirs(dataDir);
        const repoDirsById = new Map(repoDirs.map(repo => [repo.repoId, repo.dir]));
        const repoIds = new Set<string>([...repoDirs.map(repo => repo.repoId), ...runsByRepo.keys()]);
        const snapshots: ScheduleSnapshot[] = [];

        for (const repoId of [...repoIds].sort()) {
            const repoDir = repoDirsById.get(repoId) ?? path.join(dataDir, 'repos', repoId);
            const schedulesDir = getRepoDataPath(dataDir, repoId, 'schedules');
            const scheduleRuns = runsByRepo.get(repoId) ?? [];
            const schedules: unknown[] = [];

            if (isDirectory(schedulesDir)) {
                const yamlFiles = fs.readdirSync(schedulesDir)
                    .filter(f => f.endsWith('.yaml'))
                    .sort();

                for (const file of yamlFiles) {
                    const filePath = path.join(schedulesDir, file);
                    try {
                        const parsed = yaml.load(fs.readFileSync(filePath, 'utf-8'));
                        if (parsed && typeof parsed === 'object') {
                            schedules.push(parsed);
                        }
                    } catch (err) {
                        warnings.push(skippedWarning('schedule file', filePath, err));
                    }
                }
            }

            if (schedules.length > 0 || scheduleRuns.length > 0) {
                snapshots.push({
                    repoId,
                    repoRootPath: readRepoRootPathFromQueueFile(repoDir),
                    schedules,
                    scheduleRuns,
                });
            }
        }

        return { snapshots, warnings };
    }

    writeReplace(dataDir: string, store: ProcessStore, snapshots: ScheduleSnapshot[], errors: string[]): number {
        let written = 0;
        for (const snap of snapshots) {
            if (!snap.repoId) { continue; }
            try {
                const schedulesDir = getRepoDataPath(dataDir, snap.repoId, 'schedules');
                fs.mkdirSync(schedulesDir, { recursive: true });

                for (const schedule of snap.schedules) {
                    const id = (schedule as { id?: unknown })?.id;
                    if (typeof id !== 'string' || !id) { continue; }
                    writeYamlFileAtomic(path.join(schedulesDir, `${id}.yaml`), schedule);
                }

                this.writeScheduleRuns(store, snap.repoId, snap.scheduleRuns);
                written++;
            } catch (err) {
                errors.push(`Failed to write schedule files for ${snap.repoId}: ${getErrorMessage(err)}`);
            }
        }
        return written;
    }

    writeMerge(dataDir: string, store: ProcessStore, snapshots: ScheduleSnapshot[], errors: string[]): number {
        let written = 0;
        for (const snap of snapshots) {
            if (!snap.repoId) { continue; }
            try {
                const schedulesDir = getRepoDataPath(dataDir, snap.repoId, 'schedules');
                fs.mkdirSync(schedulesDir, { recursive: true });
                const existingIds = this.readExistingScheduleIds(schedulesDir);

                for (const schedule of snap.schedules) {
                    const id = (schedule as { id?: unknown })?.id;
                    if (typeof id !== 'string' || !id || existingIds.has(id)) { continue; }
                    writeYamlFileAtomic(path.join(schedulesDir, `${id}.yaml`), schedule);
                    existingIds.add(id);
                }

                this.writeScheduleRuns(store, snap.repoId, snap.scheduleRuns);
                written++;
            } catch (err) {
                errors.push(`Failed to merge schedule files for ${snap.repoId}: ${getErrorMessage(err)}`);
            }
        }
        return written;
    }

    planWipe(dataDir: string): ScheduleWipePlan {
        const scheduleFiles: string[] = [];
        const scheduleDirs: string[] = [];

        for (const repo of listRepoDirs(dataDir)) {
            const schedulesDir = path.join(repo.dir, 'schedules');
            if (!isDirectory(schedulesDir)) { continue; }
            const files = fs.readdirSync(schedulesDir)
                .filter(f => f.endsWith('.yaml'))
                .sort()
                .map(f => path.join(schedulesDir, f));
            scheduleFiles.push(...files);
            scheduleDirs.push(schedulesDir);
        }

        return { scheduleFiles, scheduleDirs };
    }

    executeWipe(plan: ScheduleWipePlan | undefined, errors: string[]): void {
        for (const filePath of plan?.scheduleFiles ?? []) {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                errors.push(`Failed to delete ${filePath}: ${getErrorMessage(err)}`);
            }
        }

        for (const dir of plan?.scheduleDirs ?? []) {
            try {
                if (fs.existsSync(dir)) {
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            } catch (err) {
                errors.push(`Failed to delete schedules dir ${dir}: ${getErrorMessage(err)}`);
            }
        }
    }

    countScheduleRuns(store: ProcessStore): number {
        if (!(store instanceof SqliteProcessStore)) { return 0; }
        try {
            return (store.getDatabase().prepare('SELECT COUNT(*) as cnt FROM schedule_runs').get() as { cnt: number }).cnt;
        } catch {
            return 0;
        }
    }

    deleteScheduleRuns(store: ProcessStore): void {
        if (!(store instanceof SqliteProcessStore)) { return; }
        try {
            store.getDatabase().prepare('DELETE FROM schedule_runs').run();
        } catch {
            // The table may not exist for older stores.
        }
    }

    private readScheduleRunsByRepo(store: ProcessStore): Map<string, unknown[]> {
        const runsByRepo = new Map<string, unknown[]>();
        if (!(store instanceof SqliteProcessStore)) { return runsByRepo; }

        try {
            const rows = store.getDatabase()
                .prepare('SELECT * FROM schedule_runs ORDER BY started_at DESC')
                .all() as ScheduleRunRow[];

            for (const row of rows) {
                const repoId = stringColumn(row, 'repo_id');
                if (!repoId) { continue; }
                if (!runsByRepo.has(repoId)) {
                    runsByRepo.set(repoId, []);
                }
                runsByRepo.get(repoId)!.push(scheduleRunRowToSnapshot(row));
            }
        } catch {
            // The table may not exist for older stores.
        }

        return runsByRepo;
    }

    private readExistingScheduleIds(schedulesDir: string): Set<string> {
        const existingIds = new Set<string>();
        if (!isDirectory(schedulesDir)) { return existingIds; }

        for (const file of fs.readdirSync(schedulesDir).filter(f => f.endsWith('.yaml'))) {
            try {
                const parsed = yaml.load(fs.readFileSync(path.join(schedulesDir, file), 'utf-8')) as { id?: unknown };
                if (typeof parsed?.id === 'string' && parsed.id) {
                    existingIds.add(parsed.id);
                }
            } catch {
                // Existing corrupt schedule files do not block merge import.
            }
        }

        return existingIds;
    }

    private writeScheduleRuns(store: ProcessStore, repoId: string, runs: unknown[]): void {
        if (!(store instanceof SqliteProcessStore) || runs.length === 0) { return; }

        const db = store.getDatabase();
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO schedule_runs (id, schedule_id, repo_id, started_at, completed_at, status, error, duration_ms, process_id, task_id)
            VALUES (@id, @scheduleId, @repoId, @startedAt, @completedAt, @status, @error, @durationMs, @processId, @taskId)
        `);
        const batch = db.transaction(() => {
            for (const run of runs) {
                const r = run as Record<string, unknown>;
                if (typeof r?.id !== 'string' || !r.id) { continue; }
                stmt.run({
                    id: r.id,
                    scheduleId: typeof r.scheduleId === 'string' ? r.scheduleId : '',
                    repoId: typeof r.repoId === 'string' ? r.repoId : repoId,
                    startedAt: typeof r.startedAt === 'string' ? r.startedAt : '',
                    completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
                    status: typeof r.status === 'string' ? r.status : 'completed',
                    error: typeof r.error === 'string' ? r.error : null,
                    durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
                    processId: typeof r.processId === 'string' ? r.processId : null,
                    taskId: typeof r.taskId === 'string' ? r.taskId : null,
                });
            }
        });
        batch();
    }
}

type ScheduleRunRow = Record<string, unknown>;

function scheduleRunRowToSnapshot(row: ScheduleRunRow): Record<string, unknown> {
    return {
        id: stringColumn(row, 'id') ?? '',
        scheduleId: stringColumn(row, 'schedule_id') ?? '',
        repoId: stringColumn(row, 'repo_id') ?? '',
        startedAt: stringColumn(row, 'started_at') ?? '',
        completedAt: stringColumn(row, 'completed_at') ?? undefined,
        status: stringColumn(row, 'status') ?? '',
        error: stringColumn(row, 'error') ?? undefined,
        durationMs: numberColumn(row, 'duration_ms') ?? undefined,
        processId: stringColumn(row, 'process_id') ?? undefined,
        taskId: stringColumn(row, 'task_id') ?? undefined,
    };
}

function stringColumn(row: ScheduleRunRow, key: string): string | undefined {
    const value = row[key];
    return typeof value === 'string' ? value : undefined;
}

function numberColumn(row: ScheduleRunRow, key: string): number | undefined {
    const value = row[key];
    return typeof value === 'number' ? value : undefined;
}
