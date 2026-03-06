/**
 * Template Watcher
 *
 * Watches `.vscode/templates/` directories for registered workspaces and
 * fires a debounced callback when template files change.  Uses Node.js
 * built-in `fs.watch` with the `recursive` option (supported natively
 * on macOS and Windows; on Linux requires Node 19+).
 *
 * Mirrors workflow-watcher.ts pattern.
 * Zero external dependencies.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export type TemplatesChangedCallback = (workspaceId: string) => void;

// ============================================================================
// TemplateWatcher
// ============================================================================

const DEBOUNCE_MS = 300;

export class TemplateWatcher {
    private watchers = new Map<string, fs.FSWatcher>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private onTemplatesChanged: TemplatesChangedCallback;

    constructor(onTemplatesChanged: TemplatesChangedCallback) {
        this.onTemplatesChanged = onTemplatesChanged;
    }

    /**
     * Start watching a workspace's `.vscode/templates/` directory.
     * No-ops gracefully if the directory does not exist.
     */
    watchWorkspace(workspaceId: string, rootPath: string): void {
        if (this.watchers.has(workspaceId)) {
            return;
        }

        const templatesDir = path.join(rootPath, '.vscode', 'templates');

        try {
            const stat = fs.statSync(templatesDir);
            if (!stat.isDirectory()) {
                return;
            }
        } catch {
            return;
        }

        try {
            const watcher = fs.watch(templatesDir, { recursive: true }, (_event, _filename) => {
                this.debounceFire(workspaceId);
            });

            watcher.on('error', (_err) => {
                this.cleanupWatcher(workspaceId);
            });

            this.watchers.set(workspaceId, watcher);
        } catch {
            // fs.watch can throw on some platforms if the path disappears
        }
    }

    /**
     * Stop watching a workspace's templates directory.
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
        const existing = this.timers.get(workspaceId);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.timers.delete(workspaceId);
            if (this.watchers.has(workspaceId)) {
                this.onTemplatesChanged(workspaceId);
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
