/**
 * RepoQueueRegistry
 *
 * Manages multiple TaskQueueManager instances, one per repository.
 * Provides registry-level operations and aggregated statistics.
 *
 * Features:
 * - Lazy queue creation (getOrCreate pattern)
 * - Repository path normalization
 * - Event forwarding from individual queues
 * - Aggregated stats across all repos
 * - Memory cleanup for removed repos
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import { TaskQueueManager } from './task-queue-manager';
import {
    TaskQueueManagerOptions,
    QueueStats,
    RegistryStats,
} from './types';

/** Events forwarded from individual queues (with repo path prepended) */
const FORWARDED_EVENTS = [
    'change',
    'taskAdded',
    'taskRemoved',
    'taskUpdated',
    'taskStarted',
    'taskCompleted',
    'taskFailed',
    'taskCancelled',
    'paused',
    'resumed',
    'drain-started',
    'drain-cancelled',
] as const;

/** Registry-level event name mapping for forwarded queue events */
const EVENT_NAME_MAP: Record<string, string> = {
    'change': 'queueChange',
};

export class RepoQueueRegistry extends EventEmitter {
    /** Map of normalized repo path → TaskQueueManager */
    private queues: Map<string, TaskQueueManager> = new Map();

    /** Map of normalized repo path → array of listener removal functions */
    private listenerCleanup: Map<string, Array<() => void>> = new Map();

    /** Default options for newly created queue managers */
    private readonly defaultQueueOptions: TaskQueueManagerOptions;

    constructor(defaultOptions: TaskQueueManagerOptions = {}) {
        super();
        this.defaultQueueOptions = defaultOptions;
    }

    // ========================================================================
    // Core Operations
    // ========================================================================

    /**
     * Get the queue manager for a repository. Creates a new queue if it doesn't exist.
     * @param repoPath Absolute path to repository (will be normalized)
     * @returns The TaskQueueManager instance for the repository
     */
    getQueueForRepo(repoPath: string): TaskQueueManager {
        const normalized = this.normalizePath(repoPath);

        const existing = this.queues.get(normalized);
        if (existing) {
            return existing;
        }

        const queue = new TaskQueueManager(this.defaultQueueOptions);
        this.queues.set(normalized, queue);
        this.setupQueueEventForwarding(normalized, queue);
        this.emit('repoAdded', normalized);

        return queue;
    }

    /**
     * Check if a repository has a registered queue.
     * @param repoPath Repository path to check (will be normalized)
     */
    hasRepo(repoPath: string): boolean {
        return this.queues.has(this.normalizePath(repoPath));
    }

    /**
     * Remove a repository's queue and clean up resources.
     * Does NOT call queue.reset() or queue.clear() - just removes the reference.
     * @param repoPath Repository path to remove (will be normalized)
     * @returns true if queue existed and was removed, false if not found
     */
    removeRepo(repoPath: string): boolean {
        const normalized = this.normalizePath(repoPath);

        if (!this.queues.has(normalized)) {
            return false;
        }

        this.removeEventForwarding(normalized);
        this.queues.delete(normalized);
        this.emit('repoRemoved', normalized);

        return true;
    }

    /**
     * Get all registered repository paths.
     * @returns Array of normalized repository paths (in insertion order)
     */
    getAllRepos(): string[] {
        return Array.from(this.queues.keys());
    }

    /**
     * Get the internal map of all queues (shallow copy).
     */
    getAllQueues(): Map<string, TaskQueueManager> {
        return new Map(this.queues);
    }

    // ========================================================================
    // Statistics
    // ========================================================================

    /**
     * Get aggregated statistics across all repositories.
     */
    getStats(): RegistryStats {
        const byRepo: Record<string, QueueStats> = {};
        const totals = {
            queued: 0,
            running: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            total: 0,
        };

        for (const [repoPath, queue] of this.queues) {
            const stats = queue.getStats();
            byRepo[repoPath] = stats;
            totals.queued += stats.queued;
            totals.running += stats.running;
            totals.completed += stats.completed;
            totals.failed += stats.failed;
            totals.cancelled += stats.cancelled;
            totals.total += stats.total;
        }

        return {
            repoCount: this.queues.size,
            totals,
            byRepo,
        };
    }

    /**
     * Get statistics for a specific repository.
     * @param repoPath Repository path (will be normalized)
     * @returns QueueStats object if queue exists, undefined if not
     */
    getRepoStats(repoPath: string): QueueStats | undefined {
        const queue = this.queues.get(this.normalizePath(repoPath));
        return queue?.getStats();
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Remove all repositories and clear the registry.
     */
    clear(): void {
        for (const normalized of this.queues.keys()) {
            this.removeEventForwarding(normalized);
        }
        this.queues.clear();
        this.emit('cleared');
    }

    /**
     * Clean up resources and prepare for shutdown.
     */
    dispose(): void {
        this.clear();
        this.removeAllListeners();
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Normalize a repository path for consistent map keys.
     */
    private normalizePath(repoPath: string): string {
        return path.resolve(repoPath);
    }

    /**
     * Set up event forwarding from a queue to the registry.
     */
    private setupQueueEventForwarding(repoPath: string, queue: TaskQueueManager): void {
        const cleanups: Array<() => void> = [];

        for (const eventName of FORWARDED_EVENTS) {
            const registryEventName = EVENT_NAME_MAP[eventName] || eventName;
            const handler = (...args: unknown[]) => {
                this.emit(registryEventName, repoPath, ...args);
            };
            queue.on(eventName, handler);
            cleanups.push(() => queue.removeListener(eventName, handler));
        }

        this.listenerCleanup.set(repoPath, cleanups);
    }

    /**
     * Remove event forwarding for a queue.
     */
    private removeEventForwarding(repoPath: string): void {
        const cleanups = this.listenerCleanup.get(repoPath);
        if (cleanups) {
            for (const cleanup of cleanups) {
                cleanup();
            }
            this.listenerCleanup.delete(repoPath);
        }
    }
}
