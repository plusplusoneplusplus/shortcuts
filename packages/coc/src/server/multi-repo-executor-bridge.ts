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
} from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore, QueueChangeEvent } from '@plusplusoneplusplus/pipeline-core';
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
    private readonly registry: RepoQueueRegistry;
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
