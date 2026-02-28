/**
 * MultiRepoQueuePersistence
 *
 * Persistence coordinator that routes per-repo queue state to and from
 * the correct per-repo TaskQueueManager instance managed by
 * MultiRepoQueueExecutorBridge. Reuses the existing PersistedQueueState
 * file format and per-repo file paths (`~/.coc/queues/repo-<hash>.json`).
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';
import { PersistedQueueState, computeRepoId, getRepoQueueFilePath, sanitizeTaskForPersistence } from './queue-persistence';
import type { QueuedTask, QueueChangeEvent } from '@plusplusoneplusplus/pipeline-core';

const CURRENT_VERSION = 3;
const DEBOUNCE_MS = 300;
const MAX_PERSISTED_HISTORY = 100;

// ============================================================================
// MultiRepoQueuePersistence
// ============================================================================

export class MultiRepoQueuePersistence {
    private readonly bridge: MultiRepoQueueExecutorBridge;
    private readonly dataDir: string;
    private readonly queuesDir: string;
    private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly dirtyRepos = new Set<string>();
    private readonly changeListeners = new Map<string, (event: QueueChangeEvent) => void>();
    private readonly bridgeChangeListener: (...args: any[]) => void;

    constructor(bridge: MultiRepoQueueExecutorBridge, dataDir: string) {
        this.bridge = bridge;
        this.dataDir = dataDir;
        this.queuesDir = path.join(dataDir, 'queues');

        // Auto-subscribe to change events for any repo (including newly created ones)
        this.bridgeChangeListener = (event: { repoPath: string }) => {
            if (!this.changeListeners.has(event.repoPath)) {
                const queueManager = this.bridge.registry.getQueueForRepo(event.repoPath);
                this.subscribeToRepo(event.repoPath, queueManager);
            }
            this.dirtyRepos.add(event.repoPath);
            this.scheduleSave(event.repoPath);
        };
        this.bridge.on('queueChange', this.bridgeChangeListener);
    }

    /**
     * Restore persisted queue state from all per-repo files.
     * For each file, routes tasks to the correct per-repo queue manager
     * via bridge.getOrCreateBridge().
     */
    restore(): void {
        // Ensure queues directory exists
        if (!fs.existsSync(this.queuesDir)) {
            fs.mkdirSync(this.queuesDir, { recursive: true });
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
                `[MultiRepoQueuePersistence] Restored ${totalRestored} pending task(s) across ${files.length} repo(s), ${totalHistory} history entry/entries\n`
            );
        }
    }

    /**
     * Save the queue state for a specific repo to disk.
     * Deletes the file if the queue and history are empty.
     */
    async save(rootPath: string): Promise<void> {
        const bridgeInstance = this.bridge.getOrCreateBridge(rootPath);

        // Access the underlying TaskQueueManager via the registry
        const queueManager = this.getQueueManager(rootPath);
        if (!queueManager) {
            return;
        }

        const queued = queueManager.getQueued();
        const running = queueManager.getRunning();
        const history = queueManager.getHistory();

        // If everything is empty, delete the file to clean up stale state
        if (queued.length === 0 && running.length === 0 && history.length === 0) {
            const filePath = getRepoQueueFilePath(this.dataDir, rootPath);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch {
                // Non-fatal
            }
            return;
        }

        const repoId = computeRepoId(rootPath);
        const sanitizedPending = await Promise.all(
            [...queued, ...running].map(t => sanitizeTaskForPersistence(t, this.dataDir))
        );
        const sanitizedHistory = await Promise.all(
            history.map(t => sanitizeTaskForPersistence(t, this.dataDir))
        );
        const state: PersistedQueueState = {
            version: CURRENT_VERSION,
            savedAt: new Date().toISOString(),
            repoRootPath: rootPath,
            repoId,
            pending: sanitizedPending,
            history: sanitizedHistory.slice(0, MAX_PERSISTED_HISTORY),
            isPaused: queueManager.isRepoPaused(repoId),
        };

        const filePath = getRepoQueueFilePath(this.dataDir, rootPath);
        this.atomicWrite(filePath, state);
    }

    /**
     * Flush all pending debounced saves and remove all change listeners.
     */
    dispose(): void {
        // Remove bridge-level listener
        this.bridge.removeListener('queueChange', this.bridgeChangeListener);

        // Flush all pending debounced saves (fire-and-forget async)
        for (const [rootPath, timer] of this.debounceTimers) {
            clearTimeout(timer);
            this.save(rootPath).catch(err =>
                process.stderr.write(`[MultiRepoQueuePersistence] Dispose save failed: ${err}\n`)
            );
        }
        this.debounceTimers.clear();
        this.dirtyRepos.clear();

        // Remove all change listeners
        for (const [rootPath, listener] of this.changeListeners) {
            const queueManager = this.getQueueManager(rootPath);
            if (queueManager) {
                queueManager.removeListener('change', listener);
            }
        }
        this.changeListeners.clear();
    }

    // ========================================================================
    // Private — restore helpers
    // ========================================================================

    private restoreRepoQueue(filePath: string): { restored: number; historyCount: number } {
        let raw: string;
        try {
            raw = fs.readFileSync(filePath, 'utf-8');
        } catch (err) {
            process.stderr.write(`[MultiRepoQueuePersistence] Failed to read ${filePath}: ${err}\n`);
            return { restored: 0, historyCount: 0 };
        }

        let state: PersistedQueueState;
        try {
            state = JSON.parse(raw);
        } catch {
            process.stderr.write(`[MultiRepoQueuePersistence] Corrupt file ${path.basename(filePath)} — skipping\n`);
            return { restored: 0, historyCount: 0 };
        }

        // v2 → v3 migration: default isPaused to false
        if (state.version === 2) {
            state = { ...state, version: 3, isPaused: false };
        }

        if (state.version !== CURRENT_VERSION) {
            process.stderr.write(
                `[MultiRepoQueuePersistence] Unknown version ${state.version} in ${path.basename(filePath)} — skipping\n`
            );
            return { restored: 0, historyCount: 0 };
        }

        // Get or create the per-repo bridge + queue manager
        this.bridge.getOrCreateBridge(state.repoRootPath);
        const queueManager = this.getQueueManager(state.repoRootPath);
        if (!queueManager) {
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
                    queueManager.enqueue({
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
            queueManager.restoreHistory(historyToRestore);
        }

        // Restore per-repo pause state
        if (state.isPaused === true && state.repoId) {
            queueManager.pauseRepo(state.repoId);
        }

        // Subscribe to change events for auto-save
        this.subscribeToRepo(state.repoRootPath, queueManager);

        return { restored: restoredPending, historyCount: historyToRestore.length };
    }

    // ========================================================================
    // Private — auto-save helpers
    // ========================================================================

    private subscribeToRepo(rootPath: string, queueManager: { on: (event: string, listener: (...args: unknown[]) => void) => void }): void {
        // Don't subscribe twice
        if (this.changeListeners.has(rootPath)) {
            return;
        }

        const listener = () => {
            this.dirtyRepos.add(rootPath);
            this.scheduleSave(rootPath);
        };
        queueManager.on('change', listener);
        this.changeListeners.set(rootPath, listener as (event: QueueChangeEvent) => void);
    }

    private scheduleSave(rootPath: string): void {
        const existing = this.debounceTimers.get(rootPath);
        if (existing !== undefined) {
            clearTimeout(existing);
        }
        this.debounceTimers.set(rootPath, setTimeout(() => {
            this.debounceTimers.delete(rootPath);
            this.save(rootPath).catch(err =>
                process.stderr.write(`[MultiRepoQueuePersistence] Debounced save failed: ${err}\n`)
            );
        }, DEBOUNCE_MS));
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
            process.stderr.write(`[MultiRepoQueuePersistence] Failed to write ${filePath}: ${err}\n`);
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    }

    // ========================================================================
    // Private — queue manager access
    // ========================================================================

    /**
     * Get the TaskQueueManager for a given rootPath by accessing the
     * registry through the bridge's getOrCreateBridge().
     */
    private getQueueManager(rootPath: string): import('@plusplusoneplusplus/pipeline-core').TaskQueueManager | undefined {
        return this.bridge.registry.getQueueForRepo(rootPath);
    }
}
