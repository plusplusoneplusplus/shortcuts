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
import { DebouncedWatcherRegistry } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Types
// ============================================================================

export type TemplatesChangedCallback = (workspaceId: string) => void;

// ============================================================================
// TemplateWatcher
// ============================================================================

const DEBOUNCE_MS = 300;

export class TemplateWatcher {
    private registry = new DebouncedWatcherRegistry<string>(DEBOUNCE_MS);
    private onTemplatesChanged: TemplatesChangedCallback;

    constructor(onTemplatesChanged: TemplatesChangedCallback) {
        this.onTemplatesChanged = onTemplatesChanged;
    }

    /**
     * Start watching a workspace's `.vscode/templates/` directory.
     * No-ops gracefully if the directory does not exist.
     */
    watchWorkspace(workspaceId: string, rootPath: string): void {
        if (this.registry.isWatching(workspaceId)) {
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

        this.registry.watch(
            workspaceId,
            templatesDir,
            (key, _changedFiles) => this.onTemplatesChanged(key),
            {
                onError: (key) => this.registry.unwatch(key),
            },
        );
    }

    /**
     * Stop watching a workspace's templates directory.
     */
    unwatchWorkspace(workspaceId: string): void {
        this.registry.unwatch(workspaceId);
    }

    /**
     * Close all watchers (called on server shutdown).
     */
    closeAll(): void {
        this.registry.closeAll();
    }

    /**
     * Returns whether a workspace is currently being watched.
     */
    isWatching(workspaceId: string): boolean {
        return this.registry.isWatching(workspaceId);
    }
}
