/**
 * Data Importer
 *
 * Validates a CoCExportPayload and restores its contents into the process
 * store, queue files, and preferences.  Supports Replace (wipe-then-restore)
 * and Merge (add-only-missing) modes.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type {
    CoCExportPayload,
    ImageBlobEntry,
    ImportOptions,
    ImportResult,
    QueueSnapshot,
} from '@plusplusoneplusplus/coc-server';
import { validateExportPayload } from '@plusplusoneplusplus/coc-server';
import { readPreferences, writePreferences } from './preferences-handler';
import { computeRepoId, getRepoQueueFilePath } from './queue-persistence';

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

    // 7. Restore preferences
    try {
        writePreferences(dataDir, payload.preferences);
    } catch (err: any) {
        result.errors.push(`Failed to write preferences: ${err.message}`);
    }

    // 8. Restore queue from written files into the manager
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

    // 5. Merge preferences
    try {
        const existing = readPreferences(dataDir);
        writePreferences(dataDir, { ...existing, ...payload.preferences });
    } catch (err: any) {
        result.errors.push(`Failed to merge preferences: ${err.message}`);
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
        const filePath = getRepoQueueFilePath(dataDir, rootPath);
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const state = {
                version: 3,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId: snap.repoId || computeRepoId(rootPath),
                pending: snap.pending,
                history: snap.history,
                isPaused: snap.isPaused ?? false,
            };
            const tmpPath = filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
            fs.renameSync(tmpPath, filePath);
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
        const filePath = getRepoQueueFilePath(dataDir, rootPath);
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

            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const state = {
                version: 3,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId: snap.repoId || computeRepoId(rootPath),
                pending: mergedPending,
                history: mergedHistory,
                isPaused: existingIsPaused || (snap.isPaused ?? false),
            };
            const tmpPath = filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
            fs.renameSync(tmpPath, filePath);
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
    for (const entry of blobs) {
        if (!entry.taskId) { continue; }
        const blobsDir = path.join(dataDir, 'blobs');
        const filePath = path.join(blobsDir, `${entry.taskId}.images.json`);
        try {
            if (!fs.existsSync(blobsDir)) {
                fs.mkdirSync(blobsDir, { recursive: true });
            }
            const tmpPath = filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(entry.images), 'utf-8');
            fs.renameSync(tmpPath, filePath);
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
    for (const entry of blobs) {
        if (!entry.taskId) { continue; }
        const blobsDir = path.join(dataDir, 'blobs');
        const filePath = path.join(blobsDir, `${entry.taskId}.images.json`);
        if (fs.existsSync(filePath)) { continue; }
        try {
            if (!fs.existsSync(blobsDir)) {
                fs.mkdirSync(blobsDir, { recursive: true });
            }
            const tmpPath = filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(entry.images), 'utf-8');
            fs.renameSync(tmpPath, filePath);
            written++;
        } catch (err: any) {
            errors.push(`Failed to write blob file for task ${entry.taskId}: ${err.message}`);
        }
    }
    return written;
}
