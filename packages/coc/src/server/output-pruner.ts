/**
 * Output Pruner
 *
 * Cleans up orphaned output files in `<dataDir>/outputs/` when processes
 * are removed, cleared, or pruned. Also purges stale queue.json entries.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { ProcessStore, AIProcess } from '@plusplusoneplusplus/pipeline-core';
import type { StoredProcessEntry, ProcessChangeCallback } from '@plusplusoneplusplus/pipeline-core';

const OUTPUTS_SUBDIR = 'outputs';

export class OutputPruner {
    private readonly store: ProcessStore;
    private readonly outputDir: string;
    private readonly dataDir: string;
    private previousChangeCallback?: ProcessChangeCallback;
    private listening = false;

    constructor(store: ProcessStore, dataDir: string) {
        this.store = store;
        this.dataDir = dataDir;
        this.outputDir = path.join(dataDir, OUTPUTS_SUBDIR);
    }

    /**
     * Scan outputDir, delete files not matching any process ID in store.
     * Returns the number of orphaned files deleted.
     */
    async cleanupOrphans(): Promise<number> {
        let files: string[];
        try {
            files = await fs.readdir(this.outputDir);
        } catch {
            return 0; // Directory doesn't exist yet
        }

        const allProcesses = await this.store.getAllProcesses();
        const processIds = new Set(allProcesses.map(p => p.id));

        let deleted = 0;
        for (const file of files) {
            // Extract process ID from filename: "<processId>.md"
            const ext = path.extname(file);
            const processId = path.basename(file, ext);
            if (!processIds.has(processId)) {
                try {
                    await fs.unlink(path.join(this.outputDir, file));
                    deleted++;
                } catch {
                    // Ignore errors (file may have been deleted concurrently)
                }
            }
        }
        return deleted;
    }

    /**
     * Delete the output file for a single process ID.
     * No-op if the file doesn't exist.
     */
    async deleteOutputFile(processId: string): Promise<void> {
        const filePath = path.join(this.outputDir, `${processId}.md`);
        try {
            await fs.unlink(filePath);
        } catch {
            // Ignore if already deleted or doesn't exist
        }
    }

    /**
     * Delete output files for multiple process IDs.
     */
    async deleteOutputFiles(processIds: string[]): Promise<void> {
        await Promise.all(processIds.map(id => this.deleteOutputFile(id)));
    }

    /**
     * Handle pruned entries from FileProcessStore's onPrune callback.
     */
    handlePrunedEntries(entries: StoredProcessEntry[]): void {
        const ids = entries.map(e => e.process.id);
        // Fire-and-forget — pruning cleanup should not block addProcess
        this.deleteOutputFiles(ids).catch(() => {});
    }

    /**
     * Purge stale entries from queue.json whose process IDs no longer exist in the store.
     * Returns the number of stale entries removed.
     */
    async cleanupStaleQueueEntries(): Promise<number> {
        const queuePath = path.join(this.dataDir, 'queue.json');
        let raw: string;
        try {
            raw = await fs.readFile(queuePath, 'utf-8');
        } catch {
            return 0; // File doesn't exist
        }

        let state: { version?: number; pending?: Array<{ id: string; processId?: string }>; history?: Array<{ id: string; processId?: string }> };
        try {
            state = JSON.parse(raw);
        } catch {
            return 0; // Corrupt file
        }

        const allProcesses = await this.store.getAllProcesses();
        const processIds = new Set(allProcesses.map(p => p.id));

        let removedCount = 0;

        // Clean pending entries whose processId is not in the store
        if (Array.isArray(state.pending)) {
            const original = state.pending.length;
            state.pending = state.pending.filter(entry => {
                if (!entry.processId) { return true; } // No linked process — keep
                return processIds.has(entry.processId);
            });
            removedCount += original - state.pending.length;
        }

        // Clean history entries whose processId is not in the store
        if (Array.isArray(state.history)) {
            const original = state.history.length;
            state.history = state.history.filter(entry => {
                if (!entry.processId) { return true; }
                return processIds.has(entry.processId);
            });
            removedCount += original - state.history.length;
        }

        if (removedCount > 0) {
            const tmpPath = queuePath + '.tmp';
            try {
                await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
                await fs.rename(tmpPath, queuePath);
            } catch {
                // Non-fatal: cleanup failure shouldn't crash the server
                try { await fs.unlink(tmpPath); } catch { /* ignore */ }
            }
        }

        return removedCount;
    }

    /**
     * Subscribe to store events for automatic cleanup.
     * Wraps any existing onProcessChange callback.
     */
    startListening(): void {
        if (this.listening) { return; }
        this.listening = true;
        this.previousChangeCallback = this.store.onProcessChange;

        this.store.onProcessChange = (event) => {
            // Forward to previous listener first
            this.previousChangeCallback?.(event);

            switch (event.type) {
                case 'process-removed':
                    if (event.process) {
                        this.deleteOutputFile(event.process.id).catch(() => {});
                    }
                    break;
                case 'processes-cleared':
                    // After clear, scan and remove all orphaned output files
                    this.cleanupOrphans().catch(() => {});
                    break;
            }
        };
    }

    /**
     * Unsubscribe from store events, restoring the previous callback.
     */
    stopListening(): void {
        if (!this.listening) { return; }
        this.listening = false;
        this.store.onProcessChange = this.previousChangeCallback;
        this.previousChangeCallback = undefined;
    }
}
