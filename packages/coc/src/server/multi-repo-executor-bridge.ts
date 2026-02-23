/**
 * MultiRepoQueueExecutorBridge
 *
 * Wraps a RepoQueueRegistry and lazily creates one QueueExecutorBridge
 * (= CLITaskExecutor + QueueExecutor) per repository. Tasks from different
 * repos execute in parallel with independent concurrency limits.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import {
    RepoQueueRegistry,
    QueueExecutor,
    TaskQueueManager,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore, QueueChangeEvent, CreateTaskInput, QueuedTask, QueueStats } from '@plusplusoneplusplus/pipeline-core';
import {
    QueueExecutorBridgeOptions,
    QueueExecutorBridge,
    createQueueExecutorBridge,
} from './queue-executor-bridge';
import { computeRepoId } from './queue-persistence';

// ============================================================================
// Types
// ============================================================================

interface RepoBridge {
    executor: QueueExecutor;
    bridge: QueueExecutorBridge;
}

// ============================================================================
// MultiRepoQueueExecutorBridge
// ============================================================================

export class MultiRepoQueueExecutorBridge extends EventEmitter {
    /** Exposed for StaleTaskDetector and MultiRepoQueuePersistence to access per-repo managers. */
    readonly registry: RepoQueueRegistry;
    private readonly store: ProcessStore;
    private readonly defaultOptions: QueueExecutorBridgeOptions;

    /** normalized rootPath → { executor, bridge } */
    private readonly bridges: Map<string, RepoBridge> = new Map();

    /** repoId (16-char hex) → normalized rootPath */
    private readonly repoIdToPath: Map<string, string> = new Map();

    constructor(
        registry: RepoQueueRegistry,
        store: ProcessStore,
        defaultOptions: QueueExecutorBridgeOptions = {},
    ) {
        super();
        this.registry = registry;
        this.store = store;
        this.defaultOptions = defaultOptions;

        // Forward queueChange events from the registry, augmenting with repoId
        this.registry.on('queueChange', (repoPath: string, event: QueueChangeEvent) => {
            const repoId = computeRepoId(repoPath);
            this.emit('queueChange', { repoPath, repoId, ...event });
        });
    }

    /**
     * Get an existing bridge or create one for `rootPath`.
     * Calls registry.getQueueForRepo(rootPath) then createQueueExecutorBridge().
     * Wires `queueChange` events from the new per-repo queue through this emitter,
     * augmenting payloads with { repoPath, repoId }.
     */
    getOrCreateBridge(rootPath: string): QueueExecutorBridge {
        const normalized = path.resolve(rootPath);

        const existing = this.bridges.get(normalized);
        if (existing) {
            return existing.bridge;
        }

        const queueManager = this.registry.getQueueForRepo(normalized);
        const { executor, bridge } = createQueueExecutorBridge(
            queueManager,
            this.store,
            this.defaultOptions,
        );

        this.bridges.set(normalized, { executor, bridge });

        // Forward drain events from the per-repo executor through this emitter
        for (const event of ['drain-start', 'drain-progress', 'drain-complete', 'drain-timeout'] as const) {
            executor.on(event, (data: any) => this.emit(event, data));
        }

        // Auto-register repoId → path mapping
        this.registerRepoId(computeRepoId(normalized), normalized);

        return bridge;
    }

    /**
     * Look up a bridge by its 16-char SHA-256 repoId.
     * Returns undefined if the repoId has not been registered.
     */
    getBridgeByRepoId(repoId: string): QueueExecutorBridge | undefined {
        const rootPath = this.repoIdToPath.get(repoId);
        if (!rootPath) {
            return undefined;
        }
        return this.bridges.get(rootPath)?.bridge;
    }

    /**
     * Record a repoId → rootPath mapping so getBridgeByRepoId() can work
     * before getOrCreateBridge() is called for that path.
     * Safe to call multiple times with the same pair.
     */
    registerRepoId(repoId: string, rootPath: string): void {
        this.repoIdToPath.set(repoId, path.resolve(rootPath));
    }

    /**
     * Returns a shallow-copy map of normalized rootPath → QueueExecutorBridge.
     */
    getAllBridges(): Map<string, QueueExecutorBridge> {
        const result = new Map<string, QueueExecutorBridge>();
        for (const [rootPath, { bridge }] of this.bridges) {
            result.set(rootPath, bridge);
        }
        return result;
    }

    /**
     * Execute a follow-up message on an existing AI session.
     * Searches across all per-repo bridges for the process.
     */
    async executeFollowUp(processId: string, message: string): Promise<void> {
        for (const { bridge } of this.bridges.values()) {
            if (await bridge.isSessionAlive(processId)) {
                return bridge.executeFollowUp(processId, message);
            }
        }
        throw new Error(`No active session found for process ${processId}`);
    }

    /**
     * Check whether any per-repo bridge has an active session for this process.
     * If no per-repo bridges exist yet, falls back to checking the store + AI service directly.
     */
    async isSessionAlive(processId: string): Promise<boolean> {
        // First check all per-repo bridges
        for (const { bridge } of this.bridges.values()) {
            if (await bridge.isSessionAlive(processId)) {
                return true;
            }
        }
        // If no bridges exist or none claim the session, check the store directly
        // to avoid false negatives when the session was created before any repo bridge
        if (this.bridges.size === 0) {
            const proc = await this.store.getProcess(processId);
            if (proc?.sdkSessionId) {
                const aiService = this.defaultOptions.aiService;
                if (aiService) {
                    try {
                        if (typeof (aiService as any).canResumeSession === 'function') {
                            return await (aiService as any).canResumeSession(proc.sdkSessionId, {});
                        }
                        return aiService.hasKeptAliveSession(proc.sdkSessionId);
                    } catch {
                        return false;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Drain all per-repo executors, waiting for running tasks to finish.
     * Returns the worst-case outcome ('timeout' if any timed out).
     */
    async drainAll(timeoutMs?: number): Promise<{ outcome: 'completed' | 'timeout' }> {
        const results = await Promise.all(
            Array.from(this.bridges.values()).map(({ executor }) =>
                executor.drainAndDispose(timeoutMs)
            ),
        );
        const hasTimeout = results.some(r => r.outcome === 'timeout');
        return { outcome: hasTimeout ? 'timeout' : 'completed' };
    }

    /**
     * Create an aggregate facade that duck-types as TaskQueueManager.
     * Routes enqueue() to the correct per-repo manager via repoId/workingDirectory,
     * aggregates reads across all managers.
     * Used as a bridge until queue-handler.ts is updated in commit 004.
     */
    createAggregateFacade(): TaskQueueManager {
        const reg = this.registry;
        const bridgeRef = this;
        let globalPaused = false;
        // Track paused repos at the facade level so pauses set before any manager exists are preserved
        const facadePausedRepos = new Set<string>();

        const allManagers = (): TaskQueueManager[] =>
            Array.from(reg.getAllQueues().values());

        const findManagerForTask = (taskId: string): TaskQueueManager | undefined => {
            for (const m of allManagers()) {
                if (m.getTask(taskId)) return m;
            }
            return undefined;
        };

        const resolveManager = (input: CreateTaskInput): TaskQueueManager => {
            const rootPath = (input as any).repoId
                || ((input.payload as any)?.workingDirectory)
                || process.cwd();
            bridgeRef.getOrCreateBridge(rootPath);
            const manager = reg.getQueueForRepo(rootPath);
            // Ensure newly created managers respect global pause state
            if (globalPaused && !manager.getStats().isPaused) {
                manager.pause();
            }
            // Apply any per-repo pauses that were set before this manager existed
            for (const pausedId of facadePausedRepos) {
                if (!manager.isRepoPaused(pausedId)) {
                    manager.pauseRepo(pausedId);
                }
            }
            return manager;
        };

        const aggregateStats = (): QueueStats => {
            const totals: QueueStats = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: globalPaused, isDraining: false };
            const allPausedRepos = new Set<string>(facadePausedRepos);
            for (const m of allManagers()) {
                const s = m.getStats();
                totals.queued += s.queued;
                totals.running += s.running;
                totals.completed += s.completed;
                totals.failed += s.failed;
                totals.cancelled += s.cancelled;
                totals.total += s.total;
                if (s.pausedRepos) {
                    for (const r of s.pausedRepos) allPausedRepos.add(r);
                }
            }
            totals.pausedRepos = Array.from(allPausedRepos);
            return totals;
        };

        // Build a duck-typed facade
        const facade = {
            enqueue: (input: CreateTaskInput): string => {
                const manager = resolveManager(input);
                return manager.enqueue(input);
            },
            getQueued: (): QueuedTask[] => allManagers().flatMap(m => m.getQueued()),
            getRunning: (): QueuedTask[] => allManagers().flatMap(m => m.getRunning()),
            getHistory: (): QueuedTask[] => allManagers().flatMap(m => m.getHistory()),
            getTask: (id: string): QueuedTask | undefined => {
                for (const m of allManagers()) {
                    const t = m.getTask(id);
                    if (t) return t;
                }
                return undefined;
            },
            getStats: aggregateStats,
            cancelTask: (id: string): boolean => findManagerForTask(id)?.cancelTask(id) ?? false,
            clear: (): void => { for (const m of allManagers()) m.clear(); },
            clearHistory: (): void => { for (const m of allManagers()) m.clearHistory(); },
            moveToTop: (id: string): boolean => findManagerForTask(id)?.moveToTop(id) ?? false,
            moveUp: (id: string): boolean => findManagerForTask(id)?.moveUp(id) ?? false,
            moveDown: (id: string): boolean => findManagerForTask(id)?.moveDown(id) ?? false,
            getPosition: (id: string): number | undefined => findManagerForTask(id)?.getPosition(id),
            pause: (): void => {
                globalPaused = true;
                for (const m of allManagers()) m.pause();
            },
            resume: (): void => {
                globalPaused = false;
                for (const m of allManagers()) m.resume();
            },
            pauseRepo: (repoId: string): void => {
                facadePausedRepos.add(repoId);
                for (const m of allManagers()) m.pauseRepo(repoId);
            },
            resumeRepo: (repoId: string): void => {
                facadePausedRepos.delete(repoId);
                for (const m of allManagers()) m.resumeRepo(repoId);
            },
            isRepoPaused: (repoId: string): boolean =>
                facadePausedRepos.has(repoId) || allManagers().some(m => m.isRepoPaused(repoId)),
            getPausedRepos: (): string[] => {
                const all = new Set<string>(facadePausedRepos);
                for (const m of allManagers()) {
                    for (const r of m.getPausedRepos()) all.add(r);
                }
                return Array.from(all);
            },
            forceFailTask: (id: string, error: string): boolean => findManagerForTask(id)?.forceFailTask(id, error) ?? false,
            forceFailRunning: (error: string): number => {
                let count = 0;
                for (const m of allManagers()) count += m.forceFailRunning(error);
                return count;
            },
            restoreHistory: (tasks: QueuedTask[]): void => {
                // Best-effort: add to first manager
                const managers = allManagers();
                if (managers.length > 0) managers[0].restoreHistory(tasks);
            },
            reset: (): void => { for (const m of allManagers()) m.reset(); },
            on: (event: string, listener: (...args: any[]) => void) => {
                // Delegate 'change' events through the registry
                if (event === 'change') {
                    reg.on('queueChange', (_repoPath: string, ...args: any[]) => listener(...args));
                }
                return facade;
            },
            removeListener: (_event: string, _listener: (...args: any[]) => void) => facade,
        };

        return facade as unknown as TaskQueueManager;
    }

    /**
     * Dispose all per-repo QueueExecutors, the registry, and clear internal state.
     */
    dispose(): void {
        for (const { executor } of this.bridges.values()) {
            executor.dispose();
        }
        this.bridges.clear();
        this.repoIdToPath.clear();
        this.registry.dispose();
        this.removeAllListeners();
    }
}
