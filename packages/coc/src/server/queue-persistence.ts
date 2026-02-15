/**
 * QueuePersistence
 *
 * Subscribes to TaskQueueManager change events, debounces writes, and
 * serializes queue state (pending tasks + recent history) to disk.
 * On startup, persisted state is restored — pending tasks are re-enqueued
 * and previously-running tasks are marked as failed.
 *
 * Uses atomic writes (temp file + rename) consistent with FileProcessStore.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

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
    pending: QueuedTask[];
    history: QueuedTask[];
}

const CURRENT_VERSION = 1;
const DEBOUNCE_MS = 300;
const MAX_PERSISTED_HISTORY = 100;

// ============================================================================
// QueuePersistence
// ============================================================================

export class QueuePersistence {
    private readonly filePath: string;
    private readonly queueManager: TaskQueueManager;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private dirty = false;
    private readonly changeListener: (event: QueueChangeEvent) => void;

    constructor(queueManager: TaskQueueManager, dataDir: string) {
        this.queueManager = queueManager;
        this.filePath = path.join(dataDir, 'queue.json');

        this.changeListener = () => {
            this.dirty = true;
            this.scheduleSave();
        };
        this.queueManager.on('change', this.changeListener);
    }

    /**
     * Restore persisted queue state. Called synchronously before executor starts.
     */
    restore(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }

        let raw: string;
        try {
            raw = fs.readFileSync(this.filePath, 'utf-8');
        } catch (err) {
            process.stderr.write(`[QueuePersistence] Failed to read ${this.filePath}: ${err}\n`);
            return;
        }

        let state: PersistedQueueState;
        try {
            state = JSON.parse(raw);
        } catch {
            process.stderr.write(`[QueuePersistence] Corrupt queue.json — skipping restore\n`);
            return;
        }

        if (state.version !== CURRENT_VERSION) {
            process.stderr.write(`[QueuePersistence] Unknown version ${state.version} — skipping restore\n`);
            return;
        }

        let restoredPending = 0;
        const failedFromRunning: QueuedTask[] = [];

        // Process pending tasks
        if (Array.isArray(state.pending)) {
            for (const task of state.pending) {
                if (task.status === 'running') {
                    // Mark previously-running tasks as failed
                    const failedTask: QueuedTask = {
                        ...task,
                        status: 'failed',
                        error: 'Server restarted — task was running when server stopped',
                        completedAt: Date.now(),
                    };
                    failedFromRunning.push(failedTask);
                } else if (task.status === 'queued') {
                    // Re-enqueue pending tasks
                    this.queueManager.enqueue({
                        type: task.type,
                        priority: task.priority,
                        payload: task.payload,
                        config: task.config,
                        displayName: task.displayName,
                    });
                    restoredPending++;
                }
            }
        }

        // Restore history (failed-from-running first, then persisted history)
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

        const historyCount = historyToRestore.length;
        process.stderr.write(
            `[QueuePersistence] Restored ${restoredPending} pending task(s), ${historyCount} history entry/entries\n`
        );
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
    // Private
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

        const state: PersistedQueueState = {
            version: CURRENT_VERSION,
            savedAt: new Date().toISOString(),
            pending: [...queued, ...running],
            history: history.slice(0, MAX_PERSISTED_HISTORY),
        };

        const tmpPath = this.filePath + '.tmp';
        try {
            fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
            fs.renameSync(tmpPath, this.filePath);
        } catch (err) {
            process.stderr.write(`[QueuePersistence] Failed to write ${this.filePath}: ${err}\n`);
            // Clean up tmp file if rename failed
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    }
}
