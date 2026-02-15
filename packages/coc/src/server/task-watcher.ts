/**
 * Task Watcher
 *
 * Watches `.vscode/tasks/` directories for registered workspaces and
 * fires a debounced callback when task files change.  Uses Node.js
 * built-in `fs.watch` with the `recursive` option (supported natively
 * on macOS and Windows; on Linux requires Node 19+).
 *
 * Zero external dependencies.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export type TasksChangedCallback = (workspaceId: string) => void;

// ============================================================================
// TaskWatcher
// ============================================================================

const DEBOUNCE_MS = 300;

export class TaskWatcher {
    private watchers = new Map<string, fs.FSWatcher>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private onTasksChanged: TasksChangedCallback;

    constructor(onTasksChanged: TasksChangedCallback) {
        this.onTasksChanged = onTasksChanged;
    }

    /**
     * Start watching a workspace's `.vscode/tasks/` directory.
     * No-ops gracefully if the directory does not exist.
     */
    watchWorkspace(workspaceId: string, rootPath: string): void {
        // Don't double-watch the same workspace
        if (this.watchers.has(workspaceId)) {
            return;
        }

        const tasksDir = path.join(rootPath, '.vscode', 'tasks');

        try {
            // Check directory exists before watching
            const stat = fs.statSync(tasksDir);
            if (!stat.isDirectory()) {
                return;
            }
        } catch {
            // Directory does not exist — skip silently
            return;
        }

        try {
            // Note: `recursive: true` is supported natively on macOS (FSEvents)
            // and Windows. On Linux, recursive mode requires Node 19+.
            // On older Linux versions this watches only the top-level directory.
            const watcher = fs.watch(tasksDir, { recursive: true }, (_event, _filename) => {
                this.debounceFire(workspaceId);
            });

            watcher.on('error', (_err) => {
                // Directory may have been deleted while watched (EPERM/ENOENT on Windows).
                // Clean up this watcher gracefully.
                this.cleanupWatcher(workspaceId);
            });

            this.watchers.set(workspaceId, watcher);
        } catch {
            // fs.watch can throw on some platforms if the path disappears
            // between statSync and watch. Ignore gracefully.
        }
    }

    /**
     * Stop watching a workspace's tasks directory.
     */
    unwatchWorkspace(workspaceId: string): void {
        this.cleanupWatcher(workspaceId);
    }

    /**
     * Close all watchers (called on server shutdown).
     */
    closeAll(): void {
        for (const [id] of this.watchers) {
            this.cleanupWatcher(id);
        }
    }

    /**
     * Returns whether a workspace is currently being watched.
     */
    isWatching(workspaceId: string): boolean {
        return this.watchers.has(workspaceId);
    }

    // ========================================================================
    // Private
    // ========================================================================

    private debounceFire(workspaceId: string): void {
        // Clear any existing timer for this workspace
        const existing = this.timers.get(workspaceId);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.timers.delete(workspaceId);
            // Only fire if the workspace is still being watched
            if (this.watchers.has(workspaceId)) {
                this.onTasksChanged(workspaceId);
            }
        }, DEBOUNCE_MS);

        this.timers.set(workspaceId, timer);
    }

    private cleanupWatcher(workspaceId: string): void {
        const timer = this.timers.get(workspaceId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(workspaceId);
        }

        const watcher = this.watchers.get(workspaceId);
        if (watcher) {
            try {
                watcher.close();
            } catch {
                // Ignore close errors
            }
            this.watchers.delete(workspaceId);
        }
    }
}
