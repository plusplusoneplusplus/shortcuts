/**
 * Review File Watcher
 *
 * Watches markdown files on disk and broadcasts WebSocket events
 * when they change. Uses Node.js `fs.watch` with debouncing.
 *
 * Pure Node.js — no VS Code dependencies.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessWebSocketServer } from './websocket';

export class ReviewFileWatcher {
    private watchers: Map<string, fs.FSWatcher> = new Map();
    private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    constructor(
        private readonly projectDir: string,
        private readonly wsServer: ProcessWebSocketServer,
        private readonly debounceMs = 300,
    ) {}

    /** Watch a specific file for changes. */
    watchFile(relativePath: string): void {
        if (this.watchers.has(relativePath)) return;

        const absPath = path.resolve(this.projectDir, relativePath);
        try {
            const watcher = fs.watch(absPath, { persistent: false }, () => {
                this.debouncedBroadcast(relativePath);
            });
            watcher.on('error', () => {
                // File may have been deleted — clean up silently
                this.unwatchFile(relativePath);
            });
            this.watchers.set(relativePath, watcher);
        } catch {
            // File may not exist yet — ignore
        }
    }

    /** Stop watching a file. */
    unwatchFile(relativePath: string): void {
        const watcher = this.watchers.get(relativePath);
        if (watcher) {
            watcher.close();
            this.watchers.delete(relativePath);
        }
        const timer = this.debounceTimers.get(relativePath);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(relativePath);
        }
    }

    /** Close all watchers. */
    closeAll(): void {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }

    /** Get the number of actively watched files. */
    get watchCount(): number {
        return this.watchers.size;
    }

    private debouncedBroadcast(relativePath: string): void {
        const existing = this.debounceTimers.get(relativePath);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this.debounceTimers.delete(relativePath);
            this.wsServer.broadcastFileEvent(relativePath, {
                type: 'document-updated',
                filePath: relativePath,
                content: '',
                comments: [],
            });
        }, this.debounceMs);
        this.debounceTimers.set(relativePath, timer);
    }
}
