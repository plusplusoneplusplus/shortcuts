/**
 * SqliteQueuePersistence
 *
 * Replaces the debounce+full-file-rewrite approach of the former JSON-based
 * queue persistence with incremental, synchronous SQLite row upserts via
 * SqliteQueueStore.
 *
 * Key differences from the former JSON persistence:
 * - No debounce — every change event produces an immediate SQLite write.
 * - No full-file rewrite — only the affected row(s) are upserted/deleted.
 * - No image blob externalisation — images stay inline in the payload JSON.
 * - History IS persisted — completed/failed/cancelled tasks are kept in SQLite
 *   and cleaned up on restart (served from the process store instead).
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type Database from 'better-sqlite3';
import { SqliteQueueStore, type TaskQueueManager, type QueueChangeEvent, type QueuedTask, type QueueItem, type PauseMarker } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from './multi-repo-queue-router';

/**
 * What to do with tasks that were running when the server last stopped.
 * - `'fail'`: mark as failed
 * - `'requeue'`: re-enqueue at high priority
 * - `'requeue-if-retriable'`: requeue only when retryCount < retryAttempts; otherwise fail
 */
export type RestartPolicy = 'fail' | 'requeue' | 'requeue-if-retriable';

// ============================================================================
// Types
// ============================================================================

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
function isTerminalStatus(status: string): boolean {
    return TERMINAL_STATUSES.has(status);
}

function isPauseMarker(item: QueueItem | undefined): item is PauseMarker {
    return (item as PauseMarker | undefined)?.kind === 'pause-marker';
}

export interface SqliteQueuePersistenceOptions {
    /** Policy for tasks that were running when the server last stopped (default: 'requeue-if-retriable'). */
    restartPolicy?: RestartPolicy;
}

/** Shape of the bridge's augmented queueChange event. */
interface BridgeQueueChangeEvent extends QueueChangeEvent {
    repoPath: string;
    repoId: string;
}

// ============================================================================
// SqliteQueuePersistence
// ============================================================================

export class SqliteQueuePersistence {
    private readonly bridge: MultiRepoQueueRouter;
    private readonly store: SqliteQueueStore;
    private readonly db: Database.Database;
    private readonly restartPolicy: RestartPolicy;

    /** Maps repoId → rootPath (persisted in queue_repo_paths table). */
    private readonly repoIdToPath = new Map<string, string>();

    private readonly bridgeChangeListener: (event: BridgeQueueChangeEvent) => void;

    constructor(
        bridge: MultiRepoQueueRouter,
        db: Database.Database,
        options?: SqliteQueuePersistenceOptions,
    ) {
        this.bridge = bridge;
        this.db = db;
        this.store = new SqliteQueueStore(db);
        this.restartPolicy = options?.restartPolicy ?? 'requeue-if-retriable';

        this.ensureRepoPathsTable();

        this.bridgeChangeListener = (event: BridgeQueueChangeEvent) => {
            const { repoPath, repoId } = event;
            this.trackRepoPath(repoId, repoPath);
            this.handleChange(repoId, repoPath, event);
        };
        this.bridge.on('queueChange', this.bridgeChangeListener);
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Restore persisted queue state from SQLite.
     * Synchronous — no file I/O, no debounce.
     */
    restore(): void {
        // 1. Load repo path mappings
        const pathRows = this.db.prepare('SELECT repo_id, root_path FROM queue_repo_paths').all() as Array<{ repo_id: string; root_path: string }>;
        for (const row of pathRows) {
            this.repoIdToPath.set(row.repo_id, row.root_path);
            this.bridge.registerRepoId(row.repo_id, row.root_path);
        }

        // 2. Restore per-repo pause states
        const repoStates = this.store.getAllQueueRepoStates();
        for (const [repoId, state] of repoStates) {
            const rootPath = this.repoIdToPath.get(repoId);
            if (!rootPath) continue;

            const now = Date.now();
            const queuePauseActive = state.queuePaused === true
                && (state.queuePausedUntil === undefined || state.queuePausedUntil > now);
            const autopilotPauseActive = state.autopilotPaused === true
                && (state.autopilotPausedUntil === undefined || state.autopilotPausedUntil > now);

            if (state.isPaused || queuePauseActive || autopilotPauseActive) {
                this.bridge.getOrCreateBridge(rootPath);
                const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
                if (queueManager) {
                    if (state.isPaused) {
                        queueManager.pauseRepo(repoId, state.pauseReason);
                    }
                    if (queuePauseActive) {
                        queueManager.pause(state.queuePausedUntil);
                    }
                    if (autopilotPauseActive) {
                        queueManager.pauseAutopilot(state.autopilotPausedUntil);
                    }
                }
            }
            if (state.queuePaused && !queuePauseActive || state.autopilotPaused && !autopilotPauseActive) {
                this.store.setQueueControlState(repoId, {
                    queuePaused: queuePauseActive,
                    queuePausedUntil: queuePauseActive ? state.queuePausedUntil : undefined,
                    autopilotPaused: autopilotPauseActive,
                    autopilotPausedUntil: autopilotPauseActive ? state.autopilotPausedUntil : undefined,
                });
            }
        }

        // 3. Restore queued items and running tasks
        const queuedItems = this.store.getQueueItems(undefined, ['queued']);
        const runningTasks = this.store.getQueueTasks(undefined, ['running']);
        const oldRunningTaskIds: string[] = [];

        let totalRestored = 0;
        const repoItemGroups = new Map<string, QueueItem[]>();
        for (const item of queuedItems) {
            const repoId = item.repoId ?? '';
            if (!repoItemGroups.has(repoId)) {
                repoItemGroups.set(repoId, []);
            }
            repoItemGroups.get(repoId)!.push(item);
        }

        for (const [repoId, repoItems] of repoItemGroups) {
            const rootPath = this.repoIdToPath.get(repoId);
            if (!rootPath) {
                process.stderr.write(
                    `[SqliteQueuePersistence] Warning: ${repoItems.length} queued item(s) with repoId='${repoId}' skipped — no root path mapping found in queue_repo_paths\n`
                );
                continue;
            }

            this.bridge.getOrCreateBridge(rootPath);
            const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
            if (!queueManager) continue;

            queueManager.restoreQueueItems(repoItems);
            totalRestored += repoItems.length;
        }

        const repoRunningTaskGroups = new Map<string, QueuedTask[]>();
        for (const task of runningTasks) {
            const repoId = task.repoId ?? '';
            if (!repoRunningTaskGroups.has(repoId)) {
                repoRunningTaskGroups.set(repoId, []);
            }
            repoRunningTaskGroups.get(repoId)!.push(task);
        }

        for (const [repoId, repoTasks] of repoRunningTaskGroups) {
            const rootPath = this.repoIdToPath.get(repoId);
            if (!rootPath) {
                process.stderr.write(
                    `[SqliteQueuePersistence] Warning: ${repoTasks.length} running task(s) with repoId='${repoId}' skipped — no root path mapping found in queue_repo_paths\n`
                );
                continue;
            }

            this.bridge.getOrCreateBridge(rootPath);
            const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
            if (!queueManager) continue;

            for (const task of repoTasks) {
                oldRunningTaskIds.push(task.id);
                totalRestored += this.restoreRunningTask(task, queueManager, repoId);
            }
        }

        // Clean up old running task rows — requeue restore creates replacement
        // rows, and failed restore removes rows in restoreRunningTask().
        for (const oldId of oldRunningTaskIds) {
            this.store.removeQueueTask(oldId);
        }

        if (totalRestored > 0) {
            process.stderr.write(
                `[SqliteQueuePersistence] Restored ${totalRestored} queue item(s) across ${repoItemGroups.size + repoRunningTaskGroups.size} repo group(s)\n`
            );
        }

        // 4. Clean up terminal tasks (completed/failed/cancelled) from queue_tasks.
        // History is now served from the process store; these rows are no longer
        // restored into in-memory history and would otherwise be orphaned.
        const terminalTasks = this.store.getQueueTasks(undefined, ['completed', 'failed', 'cancelled']);
        for (const task of terminalTasks) {
            this.store.removeQueueTask(task.id);
        }
        if (terminalTasks.length > 0) {
            process.stderr.write(
                `[SqliteQueuePersistence] Cleaned up ${terminalTasks.length} terminal task(s) from queue_tasks\n`
            );
        }
    }

    /**
     * Unsubscribe all change listeners. No flush needed — writes are synchronous.
     */
    dispose(): void {
        this.bridge.removeListener('queueChange', this.bridgeChangeListener);
    }

    // ========================================================================
    // Private — repo path tracking
    // ========================================================================

    private ensureRepoPathsTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS queue_repo_paths (
                repo_id   TEXT PRIMARY KEY,
                root_path TEXT NOT NULL
            )
        `);
    }

    private trackRepoPath(repoId: string, rootPath: string): void {
        if (this.repoIdToPath.get(repoId) === rootPath) return;
        this.repoIdToPath.set(repoId, rootPath);
        this.db.prepare(
            'INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)',
        ).run(repoId, rootPath);
    }

    // ========================================================================
    // Private — incremental change handler (no debounce)
    // ========================================================================

    private handleChange(repoId: string, rootPath: string, event: QueueChangeEvent): void {
        // Safety net: enrich task with repoId if missing (defense-in-depth)
        const task = event.task && !event.task.repoId ? { ...event.task, repoId } : event.task;

        switch (event.type) {
            case 'added':
            case 'updated':
            case 'frozen':
            case 'unfrozen':
            case 'admitted':
            case 'unadmitted':
                if (task) {
                    this.store.upsertQueueTask(task);
                }
                this.persistQueuedItems(repoId, rootPath);
                break;

            case 'pause-marker-added':
                this.persistQueuedItems(repoId, rootPath);
                break;

            case 'pause-marker-removed':
                if (event.taskId) {
                    this.store.removeQueueTask(event.taskId);
                }
                this.persistQueuedItems(repoId, rootPath);
                break;

            case 'removed':
                // Persist the task's final state (completed/failed/cancelled) for history restoration.
                // Only persist terminal statuses — delete non-terminal removals (dequeue, removeTask).
                if (task && isTerminalStatus(task.status)) {
                    this.store.upsertQueueTask(task);
                } else if (event.taskId) {
                    this.store.removeQueueTask(event.taskId);
                }
                this.persistQueuedItems(repoId, rootPath);
                break;

            case 'cleared':
                this.store.clearQueueTasks(repoId);
                break;

            case 'paused':
            case 'resumed':
            case 'autopilot-paused':
            case 'autopilot-resumed':
                this.persistQueueControlState(repoId, rootPath);
                break;

            case 'repo-paused':
            case 'repo-resumed': {
                const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
                if (queueManager) {
                    const isPaused = queueManager.isRepoPaused(repoId);
                    const pauseReason = queueManager.getPauseReason(repoId);
                    this.store.setQueueRepoState(repoId, isPaused, pauseReason);
                }
                break;
            }

            case 'reordered': {
                this.persistQueuedItems(repoId, rootPath);
                break;
            }

            case 'drain-started':
            case 'drain-cancelled': {
                // Drain affects execution flow only — persist repo state in case it changed
                const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
                if (queueManager) {
                    const isPaused = queueManager.isRepoPaused(repoId);
                    const pauseReason = queueManager.getPauseReason(repoId);
                    this.store.setQueueRepoState(repoId, isPaused, pauseReason);
                }
                break;
            }
        }
    }

    private persistQueueControlState(repoId: string, rootPath: string): void {
        const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
        if (!queueManager) return;
        const stats = queueManager.getStats();
        this.store.setQueueControlState(repoId, {
            queuePaused: stats.isPaused,
            queuePausedUntil: stats.pausedUntil,
            autopilotPaused: stats.isAutopilotPaused,
            autopilotPausedUntil: stats.autopilotPausedUntil,
        });
    }

    private persistQueuedItems(repoId: string, rootPath: string): void {
        const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
        if (!queueManager) return;

        queueManager.getQueueItems().forEach((item, index) => {
            if (isPauseMarker(item)) {
                this.store.upsertQueueItem({ ...item, repoId }, repoId, index);
                return;
            }
            const queuedTask = item.repoId ? item : { ...item, repoId };
            this.store.upsertQueueTask(queuedTask, index);
        });
    }

    // ========================================================================
    // Private — restore helpers
    // ========================================================================

    private restoreRunningTask(task: QueuedTask, queueManager: TaskQueueManager, repoId: string): number {
        const policy = this.restartPolicy;
        const shouldRequeue =
            policy === 'requeue' ||
            (policy === 'requeue-if-retriable' && (task.retryCount ?? 0) < (task.config?.retryAttempts ?? 0));

        if (shouldRequeue) {
            // enqueue() assigns a new ID; the change handler persists the new task.
            // The old task row is cleaned up by the caller after the restore loop.
            queueManager.enqueue({
                type: task.type,
                priority: 'high',
                payload: task.payload,
                config: task.config,
                displayName: task.displayName,
                repoId: task.repoId,
            });
            return 1;
        } else {
            // policy === 'fail' or not retriable — remove from queue
            this.store.removeQueueTask(task.id);
            return 0;
        }
    }
}
