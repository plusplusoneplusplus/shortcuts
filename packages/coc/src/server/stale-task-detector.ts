/**
 * StaleTaskDetector
 *
 * Periodically checks for running queue tasks that appear stuck/stale
 * and force-fails them. A task is considered stale when it has been
 * running for longer than its configured timeout plus a grace period.
 *
 * This handles the case where tasks are killed externally (e.g., server
 * killed via signal, process crash) without going through the normal
 * cancellation flow, leaving them stuck in 'running' state.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { TaskQueueManager, DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Types
// ============================================================================

export interface StaleTaskDetectorOptions {
    /** How often to check for stale tasks, in milliseconds (default: 60000 = 1 minute) */
    checkIntervalMs?: number;
    /** Grace period added to task timeout before considering it stale (default: 300000 = 5 minutes) */
    gracePeriodMs?: number;
    /** Fallback timeout for tasks without a configured timeout (default: DEFAULT_AI_TIMEOUT_MS) */
    defaultTimeoutMs?: number;
}

const DEFAULT_CHECK_INTERVAL_MS = 60_000;    // 1 minute
const DEFAULT_GRACE_PERIOD_MS = 5 * 60_000;  // 5 minutes

// ============================================================================
// StaleTaskDetector
// ============================================================================

export class StaleTaskDetector {
    private readonly queueManager: TaskQueueManager;
    private readonly store?: ProcessStore;
    private readonly checkIntervalMs: number;
    private readonly gracePeriodMs: number;
    private readonly defaultTimeoutMs: number;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        queueManager: TaskQueueManager,
        store?: ProcessStore,
        options: StaleTaskDetectorOptions = {}
    ) {
        this.queueManager = queueManager;
        this.store = store;
        this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
        this.gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
    }

    /**
     * Start periodic stale task detection.
     */
    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.detectAndFailStale().catch(() => {
                // Non-fatal: stale detection errors should not crash the server
            });
        }, this.checkIntervalMs);
    }

    /**
     * Stop periodic detection.
     */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Run a single detection pass — check all running tasks and force-fail stale ones.
     * @returns Number of tasks force-failed
     */
    async detectAndFailStale(): Promise<number> {
        const running = this.queueManager.getRunning();
        if (running.length === 0) return 0;

        const now = Date.now();
        let count = 0;

        for (const task of running) {
            if (!task.startedAt) continue;

            const taskTimeout = task.config?.timeoutMs ?? this.defaultTimeoutMs;
            const staleThreshold = taskTimeout + this.gracePeriodMs;
            const elapsed = now - task.startedAt;

            if (elapsed > staleThreshold) {
                const error = `Task stale — running for ${formatDuration(elapsed)}, exceeded timeout (${formatDuration(taskTimeout)}) + grace period (${formatDuration(this.gracePeriodMs)})`;
                const processId = task.processId;

                this.queueManager.forceFailTask(task.id, error);

                // Also update linked process in the store
                if (this.store && processId) {
                    try {
                        await this.store.updateProcess(processId, {
                            status: 'failed',
                            endTime: new Date(),
                            error,
                        });
                    } catch {
                        // Non-fatal
                    }
                }

                process.stderr.write(`[StaleTaskDetector] Force-failed task ${task.id} (${task.displayName || task.type}) — running for ${formatDuration(elapsed)}\n`);
                count++;
            }
        }

        return count;
    }

    /**
     * Dispose the detector — stop the timer.
     */
    dispose(): void {
        this.stop();
    }
}

/**
 * Format milliseconds as human-readable duration (e.g., "5m 30s", "2h 15m").
 */
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainSec = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainSec}s`;
    const hours = Math.floor(minutes / 60);
    const remainMin = minutes % 60;
    return `${hours}h ${remainMin}m`;
}
