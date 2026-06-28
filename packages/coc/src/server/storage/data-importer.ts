/**
 * Data Importer
 *
 * Validates a CoCExportPayload and restores its contents into the process
 * store, queue files, and preferences.  Supports Replace (wipe-then-restore)
 * and Merge (add-only-missing) modes.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
    CoCExportPayload,
    ImageBlobEntry,
    ImportOptions,
    ImportResult,
    QueueSnapshot,
    RepoPreferencesSnapshot,
    ScheduleSnapshot,
} from './export-import-types';
import { validateExportPayload } from './export-import-types';
// TODO(coc-merge): redirect to ./preferences-handler once fully migrated
import { PREFERENCES_FILE_NAME } from '../preferences-handler';
import { getRepoDataPath } from '../paths';
import { atomicWriteJson } from '../shared/fs-utils';

/** Get the per-repo queue file path (legacy JSON format). */
function getRepoQueueFilePath(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'queues.json');
}
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Public API
// ============================================================================

/**
 * Import a {@link CoCExportPayload} into the local data store.
 *
 * In **replace** mode the existing data is wiped first, then the payload is
 * fully restored.  In **merge** mode only items whose IDs do not already
 * exist in the store are added.
 */
export async function importData(
    payload: CoCExportPayload,
    options: ImportOptions,
): Promise<ImportResult> {
    // Validate payload shape
    const validation = validateExportPayload(payload);
    if (!validation.valid) {
        throw new Error(`Invalid payload: ${validation.error}`);
    }

    if (options.mode === 'replace') {
        return replaceImport(payload, options);
    }
    return mergeImport(payload, options);
}

// ============================================================================
// Replace mode
// ============================================================================

async function replaceImport(
    payload: CoCExportPayload,
    options: ImportOptions,
): Promise<ImportResult> {
    const { store, dataDir, wiper, getQueueManager, getQueuePersistence } = options;
    const result: ImportResult = {
        importedProcesses: 0,
        importedWorkspaces: 0,
        importedWikis: 0,
        importedQueueFiles: 0,
        importedBlobFiles: 0,
        importedScheduleFiles: 0,
        importedRepoPreferenceFiles: 0,
        errors: [],
    };

    // 1. Reset in-memory queue
    getQueueManager?.()?.reset();

    // 2. Wipe all persistent data
    const wipeResult = await wiper.wipeData({ includeWikis: true });
    result.errors.push(...wipeResult.errors);

    // 3. Restore processes
    for (const proc of payload.processes) {
        try {
            await store.addProcess(proc);
            result.importedProcesses++;
        } catch (err: any) {
            result.errors.push(`Failed to add process ${proc.id}: ${err.message}`);
        }
    }

    // 4. Restore workspaces
    for (const ws of payload.workspaces) {
        try {
            await store.registerWorkspace(ws);
            result.importedWorkspaces++;
        } catch (err: any) {
            result.errors.push(`Failed to add workspace ${ws.id}: ${err.message}`);
        }
    }

    // 5. Restore wikis
    for (const wiki of payload.wikis) {
        try {
            await store.registerWiki(wiki);
            result.importedWikis++;
        } catch (err: any) {
            result.errors.push(`Failed to add wiki ${wiki.id}: ${err.message}`);
        }
    }

    // 6. Restore queue files
    result.importedQueueFiles = writeQueueFiles(dataDir, payload.queueHistory, result.errors);

    // 6b. Restore blob files
    result.importedBlobFiles = writeBlobFiles(dataDir, payload.imageBlobs ?? [], result.errors);

    // 7. Restore per-repo preferences (from new repoPreferences field)
    if (payload.repoPreferences) {
        result.importedRepoPreferenceFiles = writeRepoPreferences(dataDir, payload.repoPreferences, result.errors);
    }

    // 7b. Restore global preferences
    try {
        const prefs = payload.preferences as any ?? {};
        const globalData: Record<string, unknown> = {};
        if (prefs.global !== undefined) {
            globalData.global = prefs.global;
        }
        atomicWriteJson(path.join(dataDir, PREFERENCES_FILE_NAME), globalData);
    } catch (err: any) {
        result.errors.push(`Failed to write preferences: ${err.message}`);
    }

    // 8. Restore schedule files
    if (payload.scheduleHistory) {
        result.importedScheduleFiles = writeScheduleFiles(dataDir, store, payload.scheduleHistory, result.errors);
    }

    // 9. Restore queue from written files into the manager
    try {
        getQueuePersistence?.()?.restore();
    } catch (err: any) {
        result.errors.push(`Failed to restore queue persistence: ${err.message}`);
    }

    return result;
}

// ============================================================================
// Merge mode
// ============================================================================

async function mergeImport(
    payload: CoCExportPayload,
    options: ImportOptions,
): Promise<ImportResult> {
    const { store, dataDir } = options;
    const result: ImportResult = {
        importedProcesses: 0,
        importedWorkspaces: 0,
        importedWikis: 0,
        importedQueueFiles: 0,
        importedBlobFiles: 0,
        importedScheduleFiles: 0,
        importedRepoPreferenceFiles: 0,
        errors: [],
    };

    // 1. Merge processes — skip existing IDs
    const existingProcesses = await store.getAllProcesses();
    const existingProcessIds = new Set(existingProcesses.map(p => p.id));
    for (const proc of payload.processes) {
        if (existingProcessIds.has(proc.id)) { continue; }
        try {
            await store.addProcess(proc);
            result.importedProcesses++;
        } catch (err: any) {
            result.errors.push(`Failed to add process ${proc.id}: ${err.message}`);
        }
    }

    // 2. Merge workspaces — skip existing IDs
    const existingWorkspaces = await store.getWorkspaces();
    const existingWorkspaceIds = new Set(existingWorkspaces.map(w => w.id));
    for (const ws of payload.workspaces) {
        if (existingWorkspaceIds.has(ws.id)) { continue; }
        try {
            await store.registerWorkspace(ws);
            result.importedWorkspaces++;
        } catch (err: any) {
            result.errors.push(`Failed to add workspace ${ws.id}: ${err.message}`);
        }
    }

    // 3. Merge wikis — skip existing IDs
    const existingWikis = await store.getWikis();
    const existingWikiIds = new Set(existingWikis.map(w => w.id));
    for (const wiki of payload.wikis) {
        if (existingWikiIds.has(wiki.id)) { continue; }
        try {
            await store.registerWiki(wiki);
            result.importedWikis++;
        } catch (err: any) {
            result.errors.push(`Failed to add wiki ${wiki.id}: ${err.message}`);
        }
    }

    // 4. Merge queue files — merge tasks into existing per-repo files
    result.importedQueueFiles = mergeQueueFiles(dataDir, payload.queueHistory, result.errors);

    // 4b. Merge blob files — skip existing, write only new ones
    result.importedBlobFiles = mergeBlobFiles(dataDir, payload.imageBlobs ?? [], result.errors);

    // 5. Merge per-repo preferences (from new repoPreferences field)
    if (payload.repoPreferences) {
        result.importedRepoPreferenceFiles = mergeRepoPreferences(dataDir, payload.repoPreferences, result.errors);
    }

    // 5b. Merge global preferences
    try {
        const prefs = payload.preferences as any ?? {};
        const prefFile = path.join(dataDir, PREFERENCES_FILE_NAME);
        let existingGlobal: Record<string, unknown> = {};
        if (fs.existsSync(prefFile)) {
            existingGlobal = JSON.parse(fs.readFileSync(prefFile, 'utf-8'));
        }
        if (prefs.global !== undefined) {
            existingGlobal.global = { ...(existingGlobal.global as any ?? {}), ...prefs.global };
        }
        atomicWriteJson(prefFile, existingGlobal);
    } catch (err: any) {
        result.errors.push(`Failed to merge preferences: ${err.message}`);
    }

    // 6. Merge schedule files
    if (payload.scheduleHistory) {
        result.importedScheduleFiles = mergeScheduleFiles(dataDir, store, payload.scheduleHistory, result.errors);
    }

    return result;
}

// ============================================================================
// Queue file helpers
// ============================================================================

/**
 * Write queue snapshot files to disk (replace mode — overwrite).
 * Returns the number of files successfully written.
 */
function writeQueueFiles(dataDir: string, snapshots: QueueSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        const rootPath = snap.repoRootPath;
        if (!rootPath) { continue; }
        const repoId = snap.repoId;
        if (!repoId) { continue; }
        const filePath = getRepoQueueFilePath(dataDir, repoId);
        try {
            const state = {
                version: 3,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId,
                pending: snap.pending,
                history: snap.history,
                isPaused: snap.isPaused ?? false,
            };
            atomicWriteJson(filePath, state);
            written++;
        } catch (err: any) {
            errors.push(`Failed to write queue file for ${rootPath}: ${err.message}`);
        }
    }
    return written;
}

/**
 * Merge queue snapshots into existing per-repo files on disk (merge mode).
 * For each repo: read the existing file (if any), merge pending/history
 * arrays (dedup by task ID), and write back atomically.
 * Returns the number of files successfully written.
 */
function mergeQueueFiles(dataDir: string, snapshots: QueueSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        const rootPath = snap.repoRootPath;
        if (!rootPath) { continue; }
        const repoId = snap.repoId;
        if (!repoId) { continue; }
        const filePath = getRepoQueueFilePath(dataDir, repoId);
        try {
            // Read existing state (if any)
            let existingPending: any[] = [];
            let existingHistory: any[] = [];
            let existingIsPaused = false;
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const existing = JSON.parse(raw);
                existingPending = Array.isArray(existing.pending) ? existing.pending : [];
                existingHistory = Array.isArray(existing.history) ? existing.history : [];
                existingIsPaused = existing.isPaused === true;
            }

            // Merge pending — add only tasks with new IDs
            const existingPendingIds = new Set(existingPending.map((t: any) => t.id));
            const mergedPending = [...existingPending];
            for (const task of snap.pending) {
                if (!existingPendingIds.has(task.id)) {
                    mergedPending.push(task);
                }
            }

            // Merge history — add only tasks with new IDs
            const existingHistoryIds = new Set(existingHistory.map((t: any) => t.id));
            const mergedHistory = [...existingHistory];
            for (const task of snap.history) {
                if (!existingHistoryIds.has(task.id)) {
                    mergedHistory.push(task);
                }
            }

            const state = {
                version: 3,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId,
                pending: mergedPending,
                history: mergedHistory,
                isPaused: existingIsPaused || (snap.isPaused ?? false),
            };
            atomicWriteJson(filePath, state);
            written++;
        } catch (err: any) {
            errors.push(`Failed to merge queue file for ${rootPath}: ${err.message}`);
        }
    }
    return written;
}

// ============================================================================
// Blob file helpers
// ============================================================================

/**
 * Write blob files to disk (replace mode — overwrite).
 * Returns the number of files successfully written.
 */
function writeBlobFiles(dataDir: string, blobs: ImageBlobEntry[], errors: string[]): number {
    let written = 0;
    const blobsDir = path.join(dataDir, 'blobs');
    for (const entry of blobs) {
        if (!entry.taskId) { continue; }
        const filePath = path.join(blobsDir, `${entry.taskId}.images.json`);
        try {
            atomicWriteJson(filePath, entry.images);
            written++;
        } catch (err: any) {
            errors.push(`Failed to write blob file for task ${entry.taskId}: ${err.message}`);
        }
    }
    return written;
}

/**
 * Merge blob files — skip writing if the file already exists on disk.
 * Returns the number of files successfully written.
 */
function mergeBlobFiles(dataDir: string, blobs: ImageBlobEntry[], errors: string[]): number {
    let written = 0;
    const blobsDir = path.join(dataDir, 'blobs');
    for (const entry of blobs) {
        if (!entry.taskId) { continue; }
        const filePath = path.join(blobsDir, `${entry.taskId}.images.json`);
        if (fs.existsSync(filePath)) { continue; }
        try {
            atomicWriteJson(filePath, entry.images);
            written++;
        } catch (err: any) {
            errors.push(`Failed to write blob file for task ${entry.taskId}: ${err.message}`);
        }
    }
    return written;
}

// ============================================================================
// Per-repo preferences helpers
// ============================================================================

/**
 * Write per-repo preferences to disk (replace mode — overwrite).
 * Returns the number of files successfully written.
 */
function writeRepoPreferences(dataDir: string, snapshots: RepoPreferencesSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoId) { continue; }
        const filePath = getRepoDataPath(dataDir, snap.repoId, PREFERENCES_FILE_NAME);
        try {
            atomicWriteJson(filePath, snap.preferences);
            written++;
        } catch (err: any) {
            errors.push(`Failed to write repo preferences for ${snap.repoId}: ${err.message}`);
        }
    }
    return written;
}

/**
 * Merge per-repo preferences — shallow-merge (payload wins for conflicting keys).
 * Returns the number of files successfully written.
 */
function mergeRepoPreferences(dataDir: string, snapshots: RepoPreferencesSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoId) { continue; }
        const filePath = getRepoDataPath(dataDir, snap.repoId, PREFERENCES_FILE_NAME);
        try {
            let existing: Record<string, unknown> = {};
            if (fs.existsSync(filePath)) {
                existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
            const merged = { ...existing, ...snap.preferences };
            atomicWriteJson(filePath, merged);
            written++;
        } catch (err: any) {
            errors.push(`Failed to merge repo preferences for ${snap.repoId}: ${err.message}`);
        }
    }
    return written;
}

// ============================================================================
// Schedule file helpers
// ============================================================================

/**
 * Write schedule YAML files to disk (replace mode — overwrite entire dir).
 * Each element of `snap.schedules` is written to `schedules/<id>.yaml`.
 * Schedule runs are written to the `schedule_runs` SQLite table.
 * Returns the number of repo schedule sets successfully written.
 */
function writeScheduleFiles(dataDir: string, store: ProcessStore, snapshots: ScheduleSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoId) { continue; }
        try {
            const schedulesDir = getRepoDataPath(dataDir, snap.repoId, 'schedules');
            // Ensure dir exists
            fs.mkdirSync(schedulesDir, { recursive: true });

            // Write each schedule as its own YAML file
            for (const schedule of snap.schedules) {
                const id = (schedule as any)?.id;
                if (!id) { continue; } // skip items without id
                const filePath = path.join(schedulesDir, `${id}.yaml`);
                const content = yaml.dump(schedule, { lineWidth: -1 });
                fs.writeFileSync(filePath, content, 'utf-8');
            }

            // Write schedule runs to SQLite
            writeScheduleRunsToSqlite(store, snap.repoId, snap.scheduleRuns);
            written++;
        } catch (err: any) {
            errors.push(`Failed to write schedule files for ${snap.repoId}: ${err.message}`);
        }
    }
    return written;
}

/**
 * Merge schedule YAML files — add only schedules whose `id` is not already
 * present on disk. Schedule runs are merged by id into SQLite.
 * Returns the number of repo schedule sets successfully written.
 */
function mergeScheduleFiles(dataDir: string, store: ProcessStore, snapshots: ScheduleSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoId) { continue; }
        try {
            const schedulesDir = getRepoDataPath(dataDir, snap.repoId, 'schedules');
            fs.mkdirSync(schedulesDir, { recursive: true });

            // Collect existing ids from YAML files on disk
            const existingIds = new Set<string>();
            if (fs.existsSync(schedulesDir)) {
                for (const file of fs.readdirSync(schedulesDir).filter(f => f.endsWith('.yaml'))) {
                    try {
                        const raw = fs.readFileSync(path.join(schedulesDir, file), 'utf-8');
                        const parsed = yaml.load(raw) as any;
                        if (parsed?.id) { existingIds.add(parsed.id); }
                    } catch { /* skip */ }
                }
            }

            // Write only schedules with new ids
            for (const schedule of snap.schedules) {
                const id = (schedule as any)?.id;
                if (!id || existingIds.has(id)) { continue; }
                const filePath = path.join(schedulesDir, `${id}.yaml`);
                const content = yaml.dump(schedule, { lineWidth: -1 });
                fs.writeFileSync(filePath, content, 'utf-8');
                existingIds.add(id);
            }

            // Merge schedule runs into SQLite (upsert — existing IDs are updated)
            writeScheduleRunsToSqlite(store, snap.repoId, snap.scheduleRuns);
            written++;
        } catch (err: any) {
            errors.push(`Failed to merge schedule files for ${snap.repoId}: ${err.message}`);
        }
    }
    return written;
}

/**
 * Write schedule run records to the schedule_runs SQLite table.
 * Uses INSERT OR REPLACE for idempotent upsert behavior.
 */
function writeScheduleRunsToSqlite(store: ProcessStore, repoId: string, runs: unknown[]): void {
    if (!(store instanceof SqliteProcessStore) || !runs.length) return;
    const db = store.getDatabase();
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO schedule_runs (id, schedule_id, repo_id, started_at, completed_at, status, error, duration_ms, process_id, task_id)
        VALUES (@id, @scheduleId, @repoId, @startedAt, @completedAt, @status, @error, @durationMs, @processId, @taskId)
    `);
    const batch = db.transaction(() => {
        for (const run of runs) {
            const r = run as any;
            if (!r?.id) continue;
            stmt.run({
                id: r.id,
                scheduleId: r.scheduleId ?? '',
                repoId: r.repoId ?? repoId,
                startedAt: r.startedAt ?? '',
                completedAt: r.completedAt ?? null,
                status: r.status ?? 'completed',
                error: r.error ?? null,
                durationMs: r.durationMs ?? null,
                processId: r.processId ?? null,
                taskId: r.taskId ?? null,
            });
        }
    });
    batch();
}
