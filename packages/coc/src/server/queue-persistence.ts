/**
 * QueuePersistence
 *
 * Subscribes to TaskQueueManager change events, debounces writes, and
 * serializes queue state (pending tasks + recent history) to disk.
 * On startup, persisted state is restored — pending tasks are re-enqueued
 * and previously-running tasks are marked as failed.
 *
 * Stores one file per repository: `~/.coc/repos/<workspaceId>/queues.json`
 * where <workspaceId> is derived from the repo root path.
 *
 * Uses atomic writes (temp file + rename) consistent with FileProcessStore.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { QueuedTask, QueueChangeEvent } from '@plusplusoneplusplus/forge';
import { ImageBlobStore } from './image-blob-store';
import { getRepoDataPath } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Types
// ============================================================================

export interface PersistedQueueState {
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
const MAX_PERSISTED_HISTORY_DEFAULT = 100;

// ============================================================================
// Helpers
// ============================================================================

/** Get the per-repo queue file path using a workspace ID. */
export function getRepoQueueFilePath(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'queues.json');
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
// Sanitize — externalize images before persisting
// ============================================================================

/**
 * Deep-clone a QueuedTask and externalize any `payload.images` to a blob file.
 * Returns the clone with `images: []`, `imagesFilePath`, and `imagesCount`.
 * Idempotent: if images are already absent/empty, returns clone unchanged.
 */
export async function sanitizeTaskForPersistence(task: QueuedTask, dataDir: string): Promise<QueuedTask> {
    const clone: QueuedTask = JSON.parse(JSON.stringify(task));
    const payload = clone.payload as any;
    if (Array.isArray(payload?.images) && payload.images.length > 0) {
        const filePath = await ImageBlobStore.saveImages(task.id, payload.images, dataDir);
        if (filePath) {
            payload.imagesFilePath = filePath;
            payload.imagesCount = payload.images.length;
            payload.images = [];
        }
    }
    return clone;
}

// ============================================================================
// QueuePersistence
// ============================================================================

// ============================================================================
// RestartPolicy
// ============================================================================

/**
 * What to do with tasks that were `running` when the server last stopped.
 * - `'fail'` (default): mark the task as failed with a "server restarted" message
 * - `'requeue'`: re-enqueue the task at high priority so it runs first
 * - `'requeue-if-retriable'`: requeue only when retryCount < retryAttempts; otherwise fail
 */
export type RestartPolicy = 'fail' | 'requeue' | 'requeue-if-retriable';

// ============================================================================
// Standalone helpers (shared with MultiRepoQueuePersistence)
// ============================================================================

/** Atomic JSON write using temp-file + rename (shared by both persistence classes). */
export function atomicWriteJson(filePath: string, state: PersistedQueueState): void {
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

// ============================================================================
// QueuePersistence
// ============================================================================

export interface QueuePersistenceOptions {
    /** Policy for tasks that were running when the server last stopped (default: 'fail'). */
    restartPolicy?: RestartPolicy;
    /** Maximum number of history entries to persist per repo (default: 100). */
    maxPersistedHistory?: number;
    /** Resolve a rootPath to a workspace ID. Required. */
    resolveWorkspaceId: (rootPath: string) => string;
}

export class QueuePersistence {
    private readonly dataDir: string;
    private readonly queueManager: TaskQueueManager;
    private readonly restartPolicy: RestartPolicy;
    private readonly maxPersistedHistory: number;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private dirty = false;
    private readonly changeListener: (event: QueueChangeEvent) => void;
    /** Maps repoId → rootPath for paused-but-empty repos. */
    private readonly repoRootByRepoId = new Map<string, string>();
    private readonly resolveWorkspaceId: (rootPath: string) => string;

    constructor(queueManager: TaskQueueManager, dataDir: string, options?: QueuePersistenceOptions) {
        this.queueManager = queueManager;
        this.dataDir = dataDir;
        this.restartPolicy = options?.restartPolicy ?? 'fail';
        this.maxPersistedHistory = options?.maxPersistedHistory ?? MAX_PERSISTED_HISTORY_DEFAULT;
        this.resolveWorkspaceId = options?.resolveWorkspaceId ?? (() => { throw new Error('resolveWorkspaceId is required'); });

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
        const reposDir = path.join(this.dataDir, 'repos');
        if (!fs.existsSync(reposDir)) { return; }

        const repoIds = fs.readdirSync(reposDir);
        const filePaths = repoIds
            .map(id => path.join(reposDir, id, 'queues.json'))
            .filter(f => fs.existsSync(f));

        let totalRestored = 0;
        let totalHistory = 0;

        for (const filePath of filePaths) {
            const { restored, historyCount } = this.restoreRepoQueue(filePath);
            totalRestored += restored;
            totalHistory += historyCount;
        }

        if (totalRestored > 0 || totalHistory > 0) {
            process.stderr.write(
                `[QueuePersistence] Restored ${totalRestored} pending task(s) across ${filePaths.length} repo(s), ${totalHistory} history entry/entries\n`
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
            this.save().catch(err =>
                process.stderr.write(`[QueuePersistence] Dispose save failed: ${err}\n`)
            );
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
                    const shouldRequeue = this.restartPolicy === 'requeue' ||
                        (this.restartPolicy === 'requeue-if-retriable' &&
                            (task.retryCount ?? 0) < (task.config?.retryAttempts ?? 0));

                    if (shouldRequeue) {
                        this.queueManager.enqueue({
                            type: task.type,
                            priority: 'high',
                            payload: task.payload,
                            config: task.config,
                            displayName: task.displayName,
                            repoId: task.repoId,
                        });
                        restoredPending++;
                    } else {
                        const failedTask: QueuedTask = {
                            ...task,
                            status: 'failed',
                            error: 'Server restarted — task was running when server stopped',
                            completedAt: Date.now(),
                        };
                        failedFromRunning.push(failedTask);
                    }
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
    // Private — sanitization
    // ========================================================================

    private sanitizeTasks(tasks: QueuedTask[]): Promise<QueuedTask[]> {
        return Promise.all(tasks.map(t => sanitizeTaskForPersistence(t, this.dataDir)));
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
            this.save().catch(err =>
                process.stderr.write(`[QueuePersistence] Debounced save failed: ${err}\n`)
            );
        }, DEBOUNCE_MS);
    }

    private async save(): Promise<void> {
        this.dirty = false;

        const queued = this.queueManager.getQueued();
        const running = this.queueManager.getRunning();
        const history = this.queueManager.getHistory();

        // Group all tasks by repo root path; track repoId → rootPath for pause state
        const tasksByRepo = new Map<string, {
            pending: QueuedTask[];
            history: QueuedTask[];
        }>();

        for (const task of [...queued, ...running]) {
            const rootPath = getTaskRepoPath(task);
            const repoId = this.resolveWorkspaceId(rootPath);
            this.repoRootByRepoId.set(repoId, rootPath);
            const entry = tasksByRepo.get(rootPath) || { pending: [], history: [] };
            entry.pending.push(task);
            tasksByRepo.set(rootPath, entry);
        }

        for (const task of history) {
            const rootPath = getTaskRepoPath(task);
            const repoId = this.resolveWorkspaceId(rootPath);
            this.repoRootByRepoId.set(repoId, rootPath);
            const entry = tasksByRepo.get(rootPath) || { pending: [], history: [] };
            entry.history.push(task);
            tasksByRepo.set(rootPath, entry);
        }

        // G1: Preserve paused-but-empty repos so their pause state is not lost
        for (const repoId of this.queueManager.getPausedRepos()) {
            const rootPath = this.repoRootByRepoId.get(repoId);
            if (rootPath && !tasksByRepo.has(rootPath)) {
                tasksByRepo.set(rootPath, { pending: [], history: [] });
            }
        }

        // Write a file for each repo with tasks (or non-default state)
        for (const [rootPath, { pending, history: hist }] of tasksByRepo) {
            const repoId = this.resolveWorkspaceId(rootPath);
            const sanitizedPending = await this.sanitizeTasks(pending);
            const sanitizedHist = await this.sanitizeTasks(hist);
            const state: PersistedQueueState = {
                version: CURRENT_VERSION,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId,
                pending: sanitizedPending,
                history: sanitizedHist.slice(0, this.maxPersistedHistory),
                isPaused: this.queueManager.isRepoPaused(repoId),
            };
            const filePath = getRepoQueueFilePath(this.dataDir, repoId);
            atomicWriteJson(filePath, state);
        }

        // Clean up files for repos that no longer have tasks
        this.cleanupStaleFiles(tasksByRepo);
    }

    // ========================================================================
    // Private — file operations
    // ========================================================================

    private cleanupStaleFiles(activeRepos: Map<string, unknown>): void {
        // Build set of active workspace IDs
        const activeIds = new Set<string>();
        for (const rootPath of activeRepos.keys()) {
            activeIds.add(this.resolveWorkspaceId(rootPath));
        }

        const reposDir = path.join(this.dataDir, 'repos');
        if (!fs.existsSync(reposDir)) { return; }

        for (const id of fs.readdirSync(reposDir)) {
            if (activeIds.has(id)) { continue; }
            const filePath = path.join(reposDir, id, 'queues.json');
            if (!fs.existsSync(filePath)) { continue; }
            try {
                fs.unlinkSync(filePath);
                process.stderr.write(
                    `[QueuePersistence] Deleted empty queue file: repos/${id}/queues.json\n`
                );
            } catch {
                // Non-fatal
            }
        }
    }

}
