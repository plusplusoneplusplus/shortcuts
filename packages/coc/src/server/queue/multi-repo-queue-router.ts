/**
 * Multi-repo queue router.
 *
 * Routes queue operations across repository-scoped queues. The router owns the
 * mapping between workspace/repo identifiers and the per-repo TaskQueueManager
 * + QueueExecutor pair. It does not itself execute tasks; execution is
 * delegated to each repo's QueueExecutor.
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
    sdkServiceRegistry,
    SDK_PROVIDER_COPILOT,
    toQueueProcessId,
    isQueueProcessId,
    toTaskId,
} from '@plusplusoneplusplus/forge';
import type { ProcessStore, QueueChangeEvent, CreateTaskInput, QueuedTask, QueueStats, Attachment, TurnSource } from '@plusplusoneplusplus/forge';
import { applyFollowUpToTask } from '../shared/queue-utils';
import {
    QueueExecutorBridgeOptions,
    QueueExecutorBridge,
    createQueueExecutorBridge,
} from './queue-executor-bridge';

// ============================================================================
// Types
// ============================================================================

interface RepoBridge {
    executor: QueueExecutor;
    bridge: QueueExecutorBridge;
}

// ============================================================================
// MultiRepoQueueRouter
// ============================================================================

export class MultiRepoQueueRouter extends EventEmitter {
    /** Exposed for StaleTaskDetector and SqliteQueuePersistence to access per-repo managers. */
    readonly registry: RepoQueueRegistry;
    private readonly store: ProcessStore;
    private defaultOptions: QueueExecutorBridgeOptions;

    /** normalized rootPath → { executor, bridge } */
    private readonly bridges: Map<string, RepoBridge> = new Map();

    /** repoId (workspace ID) → normalized rootPath */
    private readonly repoIdToPath: Map<string, string> = new Map();

    /** normalized rootPath → repoId (workspace ID) */
    private readonly pathToRepoId: Map<string, string> = new Map();

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
            const repoId = this.getRepoIdForPath(repoPath);
            this.emit('queueChange', { repoPath, repoId, ...event });
        });
    }

    /**
     * Clear the `initialDelayMs` from default options so bridges created
     * after the startup/restore window do not inherit the delay.
     */
    clearInitialDelay(): void {
        this.defaultOptions = { ...this.defaultOptions, initialDelayMs: 0 };
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
            { ...this.defaultOptions, workingDirectory: normalized },
        );

        this.bridges.set(normalized, { executor, bridge });

        // Forward drain events from the per-repo executor through this emitter
        for (const event of ['drain-start', 'drain-progress', 'drain-complete', 'drain-timeout'] as const) {
            executor.on(event, (data: any) => this.emit(event, data));
        }

        // Auto-register repoId → path mapping if known
        const existingRepoId = this.pathToRepoId.get(normalized);
        if (existingRepoId) {
            this.registerRepoId(existingRepoId, normalized);
        }

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
        const resolved = path.resolve(rootPath);
        this.repoIdToPath.set(repoId, resolved);
        this.pathToRepoId.set(resolved, repoId);
    }

    /**
     * Look up the repoId (workspace ID) for a given root path.
     * Returns the registered workspace ID, or falls back to the normalized path.
     * Supports subdirectory paths: if `rootPath` is under a registered workspace,
     * returns that workspace's ID (longest-prefix match wins for nested workspaces).
     */
    getRepoIdForPath(rootPath: string): string {
        const resolved = path.resolve(rootPath);
        // 1. Exact match (most common — task workingDirectory IS the workspace root)
        const exact = this.pathToRepoId.get(resolved);
        if (exact) return exact;
        // 2. Prefix match — task workingDirectory is a subdirectory of a registered workspace.
        // Find the longest matching prefix (most specific workspace wins).
        let bestId: string | undefined;
        let bestLen = 0;
        for (const [wsPath, wsId] of this.pathToRepoId) {
            if (resolved.startsWith(wsPath + path.sep) && wsPath.length > bestLen) {
                bestId = wsId;
                bestLen = wsPath.length;
            }
        }
        if (bestId) return bestId;
        return resolved; // fallback: path not under any registered workspace
    }

    /**
     * Find the TaskQueueManager that owns a given task by id.
     * Returns undefined if the task is not found in any repo queue.
     */
    findManagerForTask(taskId: string): TaskQueueManager | undefined {
        for (const m of this.registry.getAllQueues().values()) {
            if (m.getTask(taskId)) return m;
        }
        return undefined;
    }

    /**
     * Find the QueueExecutor that owns a given task by id.
     * Returns undefined if the task is not found in any repo queue.
     */
    findExecutorForTask(taskId: string): QueueExecutor | undefined {
        for (const [rootPath, m] of this.registry.getAllQueues()) {
            if (m.getTask(taskId)) return this.bridges.get(rootPath)?.executor;
        }
        return undefined;
    }

    /**
     * Get the TaskQueueManager for a given repoId (workspace ID).
     * Returns undefined if no manager has been registered for that repoId.
     */
    getManagerByRepoId(repoId: string): TaskQueueManager | undefined {
        const rootPath = this.repoIdToPath.get(repoId);
        if (!rootPath) {
            // Fallback: scan all managers by path-derived repoId
            for (const [path, m] of this.registry.getAllQueues()) {
                if (this.getRepoIdForPath(path) === repoId) return m;
            }
            return undefined;
        }
        return this.registry.getAllQueues().get(rootPath);
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
     * Cancel a running process by aborting its live AI session.
     * Routes to the correct per-repo bridge via the process's workingDirectory.
     */
    async cancelProcess(processId: string): Promise<void> {
        const proc = await this.store.getProcess(processId);
        const workingDirectory = (proc as any)?.workingDirectory as string | undefined;
        if (workingDirectory) {
            const bridge = this.getOrCreateBridge(workingDirectory);
            await bridge.cancelProcess?.(processId);
            return;
        }
        // Fallback: try all existing bridges
        for (const { bridge } of this.bridges.values()) {
            await bridge.cancelProcess?.(processId);
        }
    }

    /**
     * Execute a follow-up message on an existing AI session.
     * Searches across all per-repo bridges for the process.
     */
    async executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource): Promise<void> {
        for (const { bridge } of this.bridges.values()) {
            if (await bridge.isSessionAlive(processId)) {
                return bridge.executeFollowUp(processId, message, attachments, mode, deliveryMode, images, selectedSkillNames, model, turnSource);
            }
        }
        throw new Error(`No active session found for process ${processId}`);
    }

    /**
     * Steer a running process by injecting an immediate message.
     * Searches across all per-repo bridges for the process.
     */
    async steerProcess(processId: string, message: string): Promise<boolean> {
        for (const { bridge } of this.bridges.values()) {
            if (bridge.steerProcess) {
                const steered = await bridge.steerProcess(processId, message);
                if (steered) return true;
            }
        }
        return false;
    }

    /** Answer a pending ask-user question across all per-repo bridges. */
    async answerAskUserQuestion(processId: string, questionId: string, answer: string | string[] | boolean): Promise<boolean> {
        for (const { bridge } of this.bridges.values()) {
            if (await bridge.answerAskUserQuestion?.(processId, questionId, answer)) return true;
        }
        return false;
    }

    /** Skip a pending ask-user question across all per-repo bridges. */
    async skipAskUserQuestion(processId: string, questionId: string): Promise<boolean> {
        for (const { bridge } of this.bridges.values()) {
            if (await bridge.skipAskUserQuestion?.(processId, questionId)) return true;
        }
        return false;
    }

    /** Resolve a pending ask-user question batch across all per-repo bridges. */
    async answerAskUserQuestions(processId: string, batchId: string, answers: Array<{ questionId: string; answer?: string | string[] | boolean; skipped?: boolean }>): Promise<boolean> {
        for (const { bridge } of this.bridges.values()) {
            if (await bridge.answerAskUserQuestions?.(processId, batchId, answers)) return true;
        }
        return false;
    }

    /**
     * Check whether any per-repo bridge has an active session for this process.
     * If no per-repo bridges exist yet, falls back to checking the store + AI service directly.
     */
    async isSessionAlive(processId: string): Promise<boolean> {
        // With keepalive removed, follow-ups always create fresh sessions.
        // Delegate to per-repo bridges (which now always return true).
        for (const { bridge } of this.bridges.values()) {
            if (await bridge.isSessionAlive(processId)) {
                return true;
            }
        }
        // If no bridges exist, follow-ups are still possible via fresh sessions
        return this.bridges.size === 0;
    }

    /**
     * Check whether the AI service is available.
     * Uses the injected aiService if provided, otherwise falls back to sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT).
     */
    async isAIAvailable(): Promise<boolean> {
        const aiService = this.defaultOptions.aiService ?? sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
        try {
            const result = await aiService.isAvailable();
            return result?.available ?? false;
        } catch {
            return false;
        }
    }

    /**
     * Enqueue a task into the correct per-repo queue.
     *
     * Routing priority:
     * 1. `payload.workingDirectory` — used directly if present.
     * 2. `payload.workspaceId` — resolved to a rootPath via the process store
     *    (same logic as `resolveRootPath` in queue-shared.ts). The resolved path
     *    is also written back to `payload.workingDirectory` for downstream use.
     * 3. Falls back to `process.cwd()` when neither is available.
     *
     * This ensures work-item tasks (which carry `workspaceId` but no
     * `workingDirectory`) are routed to their workspace-specific queue and
     * therefore serialized per workspace (exclusiveConcurrency = 1).
     */
    async enqueue(input: CreateTaskInput): Promise<string> {
        let rootPath = (input.payload as any)?.workingDirectory as string | undefined;

        if (!rootPath) {
            const workspaceId = (input.payload as any)?.workspaceId as string | undefined;
            if (workspaceId) {
                const workspaces = await this.store.getWorkspaces();
                const ws = workspaces.find((w: any) => w.id === workspaceId);
                if (ws?.rootPath) {
                    rootPath = path.resolve(ws.rootPath);
                    (input.payload as any).workingDirectory = rootPath;
                }
            }
        }

        if (!rootPath) rootPath = process.cwd();

        this.getOrCreateBridge(rootPath);
        if (!input.repoId) {
            input.repoId = this.getRepoIdForPath(rootPath);
        }
        const queueManager = this.registry.getQueueForRepo(rootPath);
        return queueManager.enqueue(input);
    }

    /**
     * Find a task by its processId across all per-repo queues.
     * Returns the task id, type, and status if found.
     */
    findTaskByProcessId(processId: string): { id: string; type: string; status: string } | undefined {
        for (const manager of this.registry.getAllQueues().values()) {
            for (const task of manager.getAll()) {
                if (task.processId === processId) {
                    return { id: task.id, type: task.type, status: task.status };
                }
            }
        }
        return undefined;
    }

    /**
     * Look up a queue task by its task ID across all per-repo queues.
     */
    getTask(taskId: string): QueuedTask | undefined {
        for (const manager of this.registry.getAllQueues().values()) {
            const task = manager.getTask(taskId);
            if (task) return task;
        }
        return undefined;
    }

    /**
     * Requeue an existing task for a follow-up message.
     * Updates the task's payload with the follow-up prompt, then moves it from history → queued.
     * Falls back to reconstructing the task from the process store when in-memory history is empty.
     */
    async requeueForFollowUp(taskId: string, prompt: string, attachments?: Attachment[], imageTempDir?: string, mode?: string, deliveryMode?: string, images?: string[], selectedSkillNames?: string[]): Promise<void> {
        for (const manager of this.registry.getAllQueues().values()) {
            const existingTask = manager.getTask(taskId);
            if (!existingTask) continue;
            // Skip applyFollowUpToTask when the task is still running (not yet
            // in history), which happens during the drain race with QueueExecutor.
            if (existingTask.status !== 'running') {
                applyFollowUpToTask(manager, taskId, prompt, attachments, imageTempDir, mode, deliveryMode, images, selectedSkillNames);
                return;
            }
            // Running task — fall through to fallback enqueue below
            break;
        }
        // Fallback: task not in any in-memory queue (e.g. after server restart)
        // or still running (drain race). Reconstruct from the process store.
        const processId = toQueueProcessId(taskId);
        const proc = await this.store.getProcess(processId) ?? await this.store.getProcess(taskId);
        if (!proc) throw new Error(`Task ${taskId} not found in any queue`);
        const rootPath = proc.workingDirectory || process.cwd();
        this.getOrCreateBridge(rootPath);
        const manager = this.registry.getQueueForRepo(rootPath);
        const repoId = this.getRepoIdForPath(rootPath);
        manager.enqueue({
            id: taskId,
            processId: processId,
            type: proc.type === 'clarification' ? 'chat' : proc.type,
            priority: 'normal',
            repoId,
            payload: {
                prompt,
                processId: proc.id,
                workingDirectory: proc.workingDirectory,
                workspaceId: proc.metadata?.workspaceId,
                mode: mode || proc.metadata?.mode,
                attachments,
                imageTempDir,
                ...(images ? { images } : {}),
                ...(deliveryMode ? { deliveryMode } : {}),
            },
            config: {},
            displayName: prompt.trim().substring(0, 57) + (prompt.trim().length > 57 ? '...' : ''),
        });
    }

    /**
     * Update the displayName (and optional customTitle/lastMessagePreview)
     * of a queue task by its processId. Returns true if the task was found
     * and updated.
     */
    updateTaskDisplayName(
        processId: string,
        displayName: string,
        extras?: { customTitle?: string; lastMessagePreview?: string },
    ): boolean {
        if (!isQueueProcessId(processId)) return false;
        const taskId = toTaskId(processId);
        const manager = this.findManagerForTask(taskId);
        if (!manager) return false;
        return manager.updateTask(taskId, { displayName, ...(extras ?? {}) } as any);
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
     * Create a queue-shaped facade across all repository queues.
     *
     * The returned object intentionally exposes the TaskQueueManager-like API used
     * by older server components, but routes operations to the correct per-repo
     * TaskQueueManager based on repoId, workingDirectory, or task ownership.
     */
    createAggregateQueueFacade(): TaskQueueManager {
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
            const repoId = (input as any).repoId as string | undefined;
            const rootPath = (repoId && bridgeRef.repoIdToPath.get(repoId))
                || ((input.payload as any)?.workingDirectory)
                || process.cwd();
            bridgeRef.getOrCreateBridge(rootPath);
            if (!input.repoId) {
                input.repoId = bridgeRef.getRepoIdForPath(rootPath);
            }
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
            const totals: QueueStats = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: globalPaused, isDraining: false, isAutopilotPaused: false };
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
            getAll: (): QueuedTask[] => allManagers().flatMap(m => m.getAll()),
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
            updateTask: (id: string, updates: any): boolean => findManagerForTask(id)?.updateTask(id, updates) ?? false,
            getStats: aggregateStats,
            cancelTask: (id: string): boolean => {
                // Route through QueueExecutor so both cancelledTasks sets are updated
                const executor = bridgeRef.findExecutorForTask(id);
                if (executor) {
                    executor.cancelTask(id);
                    return true;
                }
                return findManagerForTask(id)?.cancelTask(id) ?? false;
            },
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
            requeueFromHistory: (id: string): boolean => findManagerForTask(id)?.requeueFromHistory(id) ?? false,
            returnToHistory: (id: string): boolean => findManagerForTask(id)?.returnToHistory(id) ?? false,
            forceFailRunning: (error: string): number => {
                let count = 0;
                for (const m of allManagers()) count += m.forceFailRunning(error);
                return count;
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
        this.pathToRepoId.clear();
        this.registry.dispose();
        this.removeAllListeners();
    }
}
