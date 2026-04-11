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
import { SqliteQueueStore, type TaskQueueManager, type QueueChangeEvent, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueExecutorBridge } from '../multi-repo-executor-bridge';

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
    private readonly bridge: MultiRepoQueueExecutorBridge;
    private readonly store: SqliteQueueStore;
    private readonly db: Database.Database;
    private readonly restartPolicy: RestartPolicy;

    /** Tracks which repos we've subscribed to (rootPath → change listener). */
    private readonly subscribedRepos = new Map<string, (event: QueueChangeEvent) => void>();
    /** Maps repoId → rootPath (persisted in queue_repo_paths table). */
    private readonly repoIdToPath = new Map<string, string>();

    private readonly bridgeChangeListener: (event: BridgeQueueChangeEvent) => void;

    constructor(
        bridge: MultiRepoQueueExecutorBridge,
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
            this.subscribeToRepo(repoPath);
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

            if (state.isPaused) {
                this.bridge.getOrCreateBridge(rootPath);
                const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
                if (queueManager) {
                    queueManager.pauseRepo(repoId, state.pauseReason);
                }
            }
        }

        // 3. Restore queued/running tasks
        const tasks = this.store.getQueueTasks(undefined, ['queued', 'running']);
        const oldTaskIds: string[] = [];

        let totalRestored = 0;
        const repoTaskGroups = new Map<string, QueuedTask[]>();
        for (const task of tasks) {
            const repoId = task.repoId ?? '';
            if (!repoTaskGroups.has(repoId)) {
                repoTaskGroups.set(repoId, []);
            }
            repoTaskGroups.get(repoId)!.push(task);
        }

        for (const [repoId, repoTasks] of repoTaskGroups) {
            const rootPath = this.repoIdToPath.get(repoId);
            if (!rootPath) continue;

            this.bridge.getOrCreateBridge(rootPath);
            const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
            if (!queueManager) continue;

            this.subscribeToRepo(rootPath);

            for (const task of repoTasks) {
                oldTaskIds.push(task.id);

                if (task.status === 'running') {
                    totalRestored += this.restoreRunningTask(task, queueManager, repoId);
                } else {
                    // status === 'queued'
                    queueManager.enqueue({
                        type: task.type,
                        priority: task.priority,
                        payload: task.payload,
                        config: task.config,
                        displayName: task.displayName,
                        repoId: task.repoId,
                    });
                    totalRestored++;
                }
            }
        }

        // Clean up old task rows — enqueue() creates new IDs, and the change
        // handler already persisted them. Remove stale rows to avoid duplicates.
        for (const oldId of oldTaskIds) {
            this.store.removeQueueTask(oldId);
        }

        if (totalRestored > 0) {
            process.stderr.write(
                `[SqliteQueuePersistence] Restored ${totalRestored} task(s) across ${repoTaskGroups.size} repo(s)\n`
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

        for (const [rootPath, listener] of this.subscribedRepos) {
            const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
            if (queueManager) {
                queueManager.removeListener('change', listener);
            }
        }
        this.subscribedRepos.clear();
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
    // Private — event subscription
    // ========================================================================

    private subscribeToRepo(rootPath: string): void {
        if (this.subscribedRepos.has(rootPath)) return;

        const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
        if (!queueManager) return;

        const repoId = this.bridge.getRepoIdForPath(rootPath);
        const listener = (event: QueueChangeEvent) => this.handleChange(repoId, rootPath, event);
        queueManager.on('change', listener);
        this.subscribedRepos.set(rootPath, listener);
    }

    // ========================================================================
    // Private — incremental change handler (no debounce)
    // ========================================================================

    private handleChange(repoId: string, rootPath: string, event: QueueChangeEvent): void {
        switch (event.type) {
            case 'added':
            case 'updated':
            case 'frozen':
            case 'unfrozen':
            case 'admitted':
            case 'unadmitted':
            case 'pause-marker-added':
            case 'pause-marker-removed':
                if (event.task) {
                    this.store.upsertQueueTask(event.task);
                }
                break;

            case 'removed':
                // Persist the task's final state (completed/failed/cancelled) for history restoration.
                // Only persist terminal statuses — delete non-terminal removals (dequeue, removeTask).
                if (event.task && isTerminalStatus(event.task.status)) {
                    this.store.upsertQueueTask(event.task);
                } else if (event.taskId) {
                    this.store.removeQueueTask(event.taskId);
                }
                break;

            case 'cleared':
                this.store.clearQueueTasks(repoId);
                break;

            case 'paused':
            case 'resumed':
            case 'autopilot-paused':
            case 'autopilot-resumed':
                // Global pause/resume — no per-repo state change to persist
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
                const queueManager = this.bridge.registry.getQueueForRepo(rootPath);
                if (queueManager) {
                    for (const task of queueManager.getQueued()) {
                        if (task.repoId === repoId) {
                            this.store.upsertQueueTask(task);
                        }
                    }
                }
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
