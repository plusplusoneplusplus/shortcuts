/**
 * QueuePersistence
 *
 * Subscribes to TaskQueueManager change events, debounces writes, and
 * serializes queue state (pending tasks + recent history) to disk.
 * On startup, persisted state is restored — pending tasks are re-enqueued
 * and previously-running tasks are marked as failed.
 *
 * Stores one file per repository: `~/.coc/queues/repo-<hash>.json`
 * where <hash> is the first 16 chars of the SHA-256 of the repo root path.
 *
 * Uses atomic writes (temp file + rename) consistent with FileProcessStore.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import type { QueuedTask, QueueChangeEvent } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Types
// ============================================================================

interface PersistedQueueState {
    version: number;
    savedAt: string;
    repoRootPath: string;
    repoId: string;
    pending: QueuedTask[];
    history: QueuedTask[];
    isPaused: boolean;
}

const CURRENT_VERSION = 3;
const DEBOUNCE_MS = 300;
const MAX_PERSISTED_HISTORY = 100;

// ============================================================================
// Helpers
// ============================================================================

/** Compute a deterministic 16-char hex repo ID from a root path. */
export function computeRepoId(rootPath: string): string {
    return crypto.createHash('sha256')
        .update(rootPath)
        .digest('hex')
        .substring(0, 16);
}

/** Get the per-repo queue file path. */
export function getRepoQueueFilePath(dataDir: string, rootPath: string): string {
    const repoId = computeRepoId(rootPath);
    return path.join(dataDir, 'queues', `repo-${repoId}.json`);
}

/**
 * Extract repository root path from a task's payload.
 * Falls back to process.cwd() if no workingDirectory is present.
 */
function getTaskRepoPath(task: QueuedTask): string {
    const payload = task.payload as Record<string, unknown>;
    if (payload && typeof payload.workingDirectory === 'string' && payload.workingDirectory) {
        return payload.workingDirectory;
    }
    return process.cwd();
}

// ============================================================================
// QueuePersistence
// ============================================================================

export class QueuePersistence {
    private readonly dataDir: string;
    private readonly queuesDir: string;
    private readonly queueManager: TaskQueueManager;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private dirty = false;
    private readonly changeListener: (event: QueueChangeEvent) => void;

    constructor(queueManager: TaskQueueManager, dataDir: string) {
        this.queueManager = queueManager;
        this.dataDir = dataDir;
        this.queuesDir = path.join(dataDir, 'queues');

        // Ensure queues directory exists
        if (!fs.existsSync(this.queuesDir)) {
            fs.mkdirSync(this.queuesDir, { recursive: true });
        }

        // Run migration if old format exists (idempotent)
        this.migrateFromOldFormat();

        this.changeListener = () => {
            this.dirty = true;
            this.scheduleSave();
        };
        this.queueManager.on('change', this.changeListener);
    }

    /**
     * Restore persisted queue state from all per-repo files.
     * Called synchronously before executor starts.
     */
    restore(): void {
        if (!fs.existsSync(this.queuesDir)) {
            return;
        }

        const files = fs.readdirSync(this.queuesDir)
            .filter(f => f.startsWith('repo-') && f.endsWith('.json'));

        let totalRestored = 0;
        let totalHistory = 0;

        for (const file of files) {
            const filePath = path.join(this.queuesDir, file);
            const { restored, historyCount } = this.restoreRepoQueue(filePath);
            totalRestored += restored;
            totalHistory += historyCount;
        }

        if (totalRestored > 0 || totalHistory > 0) {
            process.stderr.write(
                `[QueuePersistence] Restored ${totalRestored} pending task(s) across ${files.length} repo(s), ${totalHistory} history entry/entries\n`
            );
        }
    }

    /**
     * Flush any pending writes and remove the change listener.
     */
    dispose(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.dirty) {
            this.save();
        }
        this.queueManager.removeListener('change', this.changeListener);
    }

    // ========================================================================
    // Private — restore helpers
    // ========================================================================

    private restoreRepoQueue(filePath: string): { restored: number; historyCount: number } {
        let raw: string;
        try {
            raw = fs.readFileSync(filePath, 'utf-8');
        } catch (err) {
            process.stderr.write(`[QueuePersistence] Failed to read ${filePath}: ${err}\n`);
            return { restored: 0, historyCount: 0 };
        }

        let state: PersistedQueueState;
        try {
            state = JSON.parse(raw);
        } catch {
            process.stderr.write(`[QueuePersistence] Corrupt file ${path.basename(filePath)} — skipping\n`);
            return { restored: 0, historyCount: 0 };
        }

        if (state.version === 2) {
            // Migrate v2 → v3: default to unpaused
            state = { ...state, version: 3, isPaused: false };
        }

        if (state.version !== CURRENT_VERSION) {
            process.stderr.write(
                `[QueuePersistence] Unknown version ${state.version} in ${path.basename(filePath)} — skipping\n`
            );
            return { restored: 0, historyCount: 0 };
        }

        let restoredPending = 0;
        const failedFromRunning: QueuedTask[] = [];

        if (Array.isArray(state.pending)) {
            for (const task of state.pending) {
                if (task.status === 'running') {
                    const failedTask: QueuedTask = {
                        ...task,
                        status: 'failed',
                        error: 'Server restarted — task was running when server stopped',
                        completedAt: Date.now(),
                    };
                    failedFromRunning.push(failedTask);
                } else if (task.status === 'queued') {
                    this.queueManager.enqueue({
                        type: task.type,
                        priority: task.priority,
                        payload: task.payload,
                        config: task.config,
                        displayName: task.displayName,
                        repoId: task.repoId,
                    });
                    restoredPending++;
                }
            }
        }

        const historyToRestore: QueuedTask[] = [];
        if (failedFromRunning.length > 0) {
            historyToRestore.push(...failedFromRunning);
        }
        if (Array.isArray(state.history)) {
            historyToRestore.push(...state.history);
        }
        if (historyToRestore.length > 0) {
            this.queueManager.restoreHistory(historyToRestore);
        }

        // Restore per-repo pause state
        if (state.isPaused === true && state.repoId) {
            this.queueManager.pauseRepo(state.repoId);
        }

        return { restored: restoredPending, historyCount: historyToRestore.length };
    }

    // ========================================================================
    // Private — save helpers
    // ========================================================================

    private scheduleSave(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.save();
        }, DEBOUNCE_MS);
    }

    private save(): void {
        this.dirty = false;

        const queued = this.queueManager.getQueued();
        const running = this.queueManager.getRunning();
        const history = this.queueManager.getHistory();

        // Group all tasks by repo root path
        const tasksByRepo = new Map<string, {
            pending: QueuedTask[];
            history: QueuedTask[];
        }>();

        for (const task of [...queued, ...running]) {
            const rootPath = getTaskRepoPath(task);
            const entry = tasksByRepo.get(rootPath) || { pending: [], history: [] };
            entry.pending.push(task);
            tasksByRepo.set(rootPath, entry);
        }

        for (const task of history) {
            const rootPath = getTaskRepoPath(task);
            const entry = tasksByRepo.get(rootPath) || { pending: [], history: [] };
            entry.history.push(task);
            tasksByRepo.set(rootPath, entry);
        }

        // Write a file for each repo with tasks
        for (const [rootPath, { pending, history: hist }] of tasksByRepo) {
            const repoId = computeRepoId(rootPath);
            const state: PersistedQueueState = {
                version: CURRENT_VERSION,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId,
                pending,
                history: hist.slice(0, MAX_PERSISTED_HISTORY),
                isPaused: this.queueManager.isRepoPaused(repoId),
            };
            const filePath = getRepoQueueFilePath(this.dataDir, rootPath);
            this.atomicWrite(filePath, state);
        }

        // Clean up files for repos that no longer have tasks
        this.cleanupStaleFiles(tasksByRepo);
    }

    // ========================================================================
    // Private — file operations
    // ========================================================================

    private atomicWrite(filePath: string, state: PersistedQueueState): void {
        const tmpPath = filePath + '.tmp';
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
            fs.renameSync(tmpPath, filePath);
        } catch (err) {
            process.stderr.write(`[QueuePersistence] Failed to write ${filePath}: ${err}\n`);
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    }

    private cleanupStaleFiles(activeRepos: Map<string, unknown>): void {
        if (!fs.existsSync(this.queuesDir)) { return; }

        // Build set of active repo file basenames
        const activeFiles = new Set<string>();
        for (const rootPath of activeRepos.keys()) {
            const repoId = computeRepoId(rootPath);
            activeFiles.add(`repo-${repoId}.json`);
        }

        const files = fs.readdirSync(this.queuesDir)
            .filter(f => f.startsWith('repo-') && f.endsWith('.json'));

        for (const file of files) {
            if (!activeFiles.has(file)) {
                const filePath = path.join(this.queuesDir, file);
                try {
                    fs.unlinkSync(filePath);
                    process.stderr.write(
                        `[QueuePersistence] Deleted empty queue file: ${file}\n`
                    );
                } catch {
                    // Non-fatal
                }
            }
        }
    }

    // ========================================================================
    // Private — migration
    // ========================================================================

    private migrateFromOldFormat(): void {
        const oldPath = path.join(this.dataDir, 'queue.json');
        if (!fs.existsSync(oldPath)) { return; }

        try {
            const raw = fs.readFileSync(oldPath, 'utf-8');
            const oldState = JSON.parse(raw);

            if (oldState.version !== 1) { return; }

            // Group tasks by workingDirectory, preserving original pending/history split
            const tasksByRepo = new Map<string, { pending: QueuedTask[]; history: QueuedTask[] }>();

            const oldPending: QueuedTask[] = Array.isArray(oldState.pending) ? oldState.pending : [];
            const oldHistory: QueuedTask[] = Array.isArray(oldState.history) ? oldState.history : [];

            for (const task of oldPending) {
                const rootPath = getTaskRepoPath(task);
                const entry = tasksByRepo.get(rootPath) || { pending: [], history: [] };
                entry.pending.push(task);
                tasksByRepo.set(rootPath, entry);
            }
            for (const task of oldHistory) {
                const rootPath = getTaskRepoPath(task);
                const entry = tasksByRepo.get(rootPath) || { pending: [], history: [] };
                entry.history.push(task);
                tasksByRepo.set(rootPath, entry);
            }

            // Write per-repo queue files
            for (const [rootPath, { pending, history }] of tasksByRepo) {
                const newState: PersistedQueueState = {
                    version: CURRENT_VERSION,
                    savedAt: new Date().toISOString(),
                    repoRootPath: rootPath,
                    repoId: computeRepoId(rootPath),
                    pending,
                    history: history.slice(0, MAX_PERSISTED_HISTORY),
                    isPaused: false,
                };

                const newPath = getRepoQueueFilePath(this.dataDir, rootPath);
                this.atomicWrite(newPath, newState);
            }

            // Archive old file
            fs.renameSync(oldPath, oldPath + '.migrated');

            process.stderr.write(
                `[QueuePersistence] Migrated queue.json to ${tasksByRepo.size} per-repo file(s)\n`
            );
        } catch (err) {
            process.stderr.write(`[QueuePersistence] Migration failed: ${err}\n`);
        }
    }
}
