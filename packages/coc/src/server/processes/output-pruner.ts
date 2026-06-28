/**
 * Output Pruner
 *
 * Cleans up orphaned output files under per-repo outputs/ directories when
 * processes are removed, cleared, or pruned. Also purges stale queue.json entries.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { StoredProcessEntry, ProcessChangeCallback } from '@plusplusoneplusplus/forge';

async function getAllProcessIds(store: ProcessStore): Promise<Set<string>> {
    return new Set(await store.getProcessIds());
}

export class OutputPruner {
    private readonly store: ProcessStore;
    private readonly dataDir: string;
    private previousChangeCallback?: ProcessChangeCallback;
    private listening = false;

    constructor(store: ProcessStore, dataDir: string) {
        this.store = store;
        this.dataDir = dataDir;
    }

    /**
     * Scan all per-repo outputs/ directories, delete files not matching any
     * process ID in the store. Returns the number of orphaned files deleted.
     */
    async cleanupOrphans(): Promise<number> {
        const reposDir = path.join(this.dataDir, 'repos');
        let repoDirs: string[];
        try {
            const entries = await fs.readdir(reposDir, { withFileTypes: true });
            repoDirs = entries.filter(e => e.isDirectory()).map(e => path.join(reposDir, e.name, 'outputs'));
        } catch {
            return 0;
        }

        const processIds = await getAllProcessIds(this.store);

        let deleted = 0;
        for (const outputDir of repoDirs) {
            let files: string[];
            try {
                files = await fs.readdir(outputDir);
            } catch {
                continue;
            }

            for (const file of files) {
                const ext = path.extname(file);
                const processId = path.basename(file, ext);
                if (!processIds.has(processId)) {
                    try {
                        await fs.unlink(path.join(outputDir, file));
                        deleted++;
                    } catch {
                        // Ignore errors (file may have been deleted concurrently)
                    }
                }
            }
        }
        return deleted;
    }

    /**
     * Delete the output file for a single process.
     * Uses the stored rawStdoutFilePath if available, otherwise no-op.
     */
    async deleteOutputFile(processId: string): Promise<void> {
        try {
            const proc = await this.store.getProcess(processId);
            if (proc?.rawStdoutFilePath) {
                await fs.unlink(proc.rawStdoutFilePath);
            }
        } catch {
            // Ignore if already deleted or process not found
        }
    }

    /**
     * Delete output files for multiple process entries.
     * Uses rawStdoutFilePath from each entry's process object.
     */
    async deleteOutputFiles(entries: StoredProcessEntry[]): Promise<void> {
        await Promise.all(entries.map(async (entry) => {
            const filePath = entry.process.rawStdoutFilePath;
            if (filePath) {
                try { await fs.unlink(filePath); } catch { /* ignore */ }
            }
        }));
    }

    /**
     * Handle pruned entries from FileProcessStore's onPrune callback.
     */
    handlePrunedEntries(entries: StoredProcessEntry[]): void {
        this.deleteOutputFiles(entries).catch(() => {});
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
            return 0;
        }

        let state: { version?: number; pending?: Array<{ id: string; processId?: string }>; history?: Array<{ id: string; processId?: string }> };
        try {
            state = JSON.parse(raw);
        } catch {
            return 0;
        }

        const processIds = await getAllProcessIds(this.store);

        let removedCount = 0;

        if (Array.isArray(state.pending)) {
            const original = state.pending.length;
            state.pending = state.pending.filter(entry => {
                if (!entry.processId) { return true; }
                return processIds.has(entry.processId);
            });
            removedCount += original - state.pending.length;
        }

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
            this.previousChangeCallback?.(event);

            switch (event.type) {
                case 'process-removed':
                    if (event.process?.rawStdoutFilePath) {
                        fs.unlink(event.process.rawStdoutFilePath).catch(() => {});
                    }
                    break;
                case 'processes-cleared':
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
