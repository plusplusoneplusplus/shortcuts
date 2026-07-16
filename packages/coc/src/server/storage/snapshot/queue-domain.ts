/**
 * Queue snapshot domain.
 *
 * Owns export/import/wipe for per-repo `queues.json` files and the SQLite queue
 * tables (`queue_tasks`, `queue_repo_state`, and the optional
 * `queue_repo_paths`).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { QueueSnapshot } from '../export-import-types';
import { getRepoDataPath } from '../../paths';
import { atomicWriteJson } from '../../shared/fs-utils';
import type { StorageSnapshotDomain } from './types';
import {
    getErrorMessage,
    listRepoDirs,
    listRepoFiles,
    readJsonFile,
    skippedWarning,
} from './snapshot-fs';

export function createQueueDomain(): StorageSnapshotDomain<{ queueFiles: string[] }> {
    return {
        id: 'queue',
        collect(ctx) {
            const snapshots: QueueSnapshot[] = [];
            const warnings: string[] = [];

            for (const repo of listRepoDirs(ctx.dataDir)) {
                const filePath = path.join(repo.dir, 'queues.json');
                if (!fs.existsSync(filePath)) { continue; }
                const parsed = readJsonFile<Record<string, unknown>>(filePath);
                if (!parsed.ok) {
                    warnings.push(skippedWarning('queue file', filePath, parsed.error));
                    continue;
                }

                snapshots.push({
                    repoRootPath: typeof parsed.value.repoRootPath === 'string' ? parsed.value.repoRootPath : '',
                    repoId: typeof parsed.value.repoId === 'string' ? parsed.value.repoId : '',
                    pending: Array.isArray(parsed.value.pending) ? parsed.value.pending as QueueSnapshot['pending'] : [],
                    history: Array.isArray(parsed.value.history) ? parsed.value.history as QueueSnapshot['history'] : [],
                    isPaused: parsed.value.isPaused === true ? true : undefined,
                });
            }

            return {
                data: { queueHistory: snapshots },
                metadata: { queueFileCount: snapshots.length },
                warnings,
            };
        },
        restoreReplace(payload, ctx, result) {
            result.importedQueueFiles = writeQueueFiles(ctx.dataDir, payload.queueHistory, result.errors);
        },
        restoreMerge(payload, ctx, result) {
            result.importedQueueFiles = mergeQueueFiles(ctx.dataDir, payload.queueHistory, result.errors);
        },
        planWipe(ctx) {
            const queueFiles = listRepoFiles(ctx.dataDir, 'queues.json');
            return {
                plan: { queueFiles },
                counts: { deletedQueues: countQueueRows(ctx.store) + queueFiles.length },
                errors: [],
            };
        },
        executeWipe(ctx, plan, result) {
            try {
                deleteQueueRows(ctx.store);
            } catch (err) {
                result.errors.push(`Failed to clear queue tables: ${getErrorMessage(err)}`);
            }

            for (const filePath of plan?.queueFiles ?? []) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    result.errors.push(`Failed to delete queue file ${filePath}: ${getErrorMessage(err)}`);
                }
            }
        },
    };
}

function writeQueueFiles(dataDir: string, snapshots: QueueSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoRootPath || !snap.repoId) { continue; }
        try {
            atomicWriteJson(getRepoDataPath(dataDir, snap.repoId, 'queues.json'), {
                version: 3,
                savedAt: new Date().toISOString(),
                repoRootPath: snap.repoRootPath,
                repoId: snap.repoId,
                pending: snap.pending,
                history: snap.history,
                isPaused: snap.isPaused ?? false,
            });
            written++;
        } catch (err) {
            errors.push(`Failed to write queue file for ${snap.repoRootPath}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function mergeQueueFiles(dataDir: string, snapshots: QueueSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoRootPath || !snap.repoId) { continue; }
        const filePath = getRepoDataPath(dataDir, snap.repoId, 'queues.json');
        try {
            let existingPending: unknown[] = [];
            let existingHistory: unknown[] = [];
            let existingIsPaused = false;
            if (fs.existsSync(filePath)) {
                const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
                existingPending = Array.isArray(existing.pending) ? existing.pending : [];
                existingHistory = Array.isArray(existing.history) ? existing.history : [];
                existingIsPaused = existing.isPaused === true;
            }

            const existingPendingIds = new Set(existingPending.map(taskId));
            const existingHistoryIds = new Set(existingHistory.map(taskId));
            const mergedPending = [...existingPending];
            const mergedHistory = [...existingHistory];

            for (const task of snap.pending) {
                if (!existingPendingIds.has(taskId(task))) {
                    mergedPending.push(task);
                }
            }
            for (const task of snap.history) {
                if (!existingHistoryIds.has(taskId(task))) {
                    mergedHistory.push(task);
                }
            }

            atomicWriteJson(filePath, {
                version: 3,
                savedAt: new Date().toISOString(),
                repoRootPath: snap.repoRootPath,
                repoId: snap.repoId,
                pending: mergedPending,
                history: mergedHistory,
                isPaused: existingIsPaused || (snap.isPaused ?? false),
            });
            written++;
        } catch (err) {
            errors.push(`Failed to merge queue file for ${snap.repoRootPath}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function countQueueRows(store: ProcessStore): number {
    if (!(store instanceof SqliteProcessStore)) { return 0; }
    const db = store.getDatabase();
    try {
        const taskCount = (db.prepare('SELECT COUNT(*) as cnt FROM queue_tasks').get() as { cnt: number }).cnt;
        const stateCount = (db.prepare('SELECT COUNT(*) as cnt FROM queue_repo_state').get() as { cnt: number }).cnt;
        return taskCount + stateCount;
    } catch {
        return 0;
    }
}

function deleteQueueRows(store: ProcessStore): void {
    if (!(store instanceof SqliteProcessStore)) { return; }
    const db = store.getDatabase();
    db.prepare('DELETE FROM queue_tasks').run();
    db.prepare('DELETE FROM queue_repo_state').run();
    try {
        db.prepare('DELETE FROM queue_repo_paths').run();
    } catch {
        // The optional table is created lazily by SqliteQueuePersistence.
    }
}

function taskId(task: unknown): unknown {
    return typeof task === 'object' && task !== null ? (task as { id?: unknown }).id : undefined;
}
