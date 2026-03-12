/**
 * Workflow Watcher
 *
 * Watches `.vscode/workflows/` directories for registered workspaces and
 * fires a debounced callback when workflow files change.  Uses Node.js
 * built-in `fs.watch` with the `recursive` option (supported natively
 * on macOS and Windows; on Linux requires Node 19+).
 *
 * Mirrors task-watcher.ts pattern.
 * Zero external dependencies.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { DebouncedWatcherRegistry } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Types
// ============================================================================

export type WorkflowsChangedCallback = (workspaceId: string) => void;

// ============================================================================
// WorkflowWatcher
// ============================================================================

const DEBOUNCE_MS = 300;

export class WorkflowWatcher {
    private registry = new DebouncedWatcherRegistry<string>(DEBOUNCE_MS);
    private onWorkflowsChanged: WorkflowsChangedCallback;

    constructor(onWorkflowsChanged: WorkflowsChangedCallback) {
        this.onWorkflowsChanged = onWorkflowsChanged;
    }

    /**
     * Start watching a workspace's `.vscode/workflows/` directory.
     * No-ops gracefully if the directory does not exist.
     */
    watchWorkspace(workspaceId: string, rootPath: string): void {
        if (this.registry.isWatching(workspaceId)) {
            return;
        }

        const pipelinesDir = path.join(rootPath, '.vscode', 'workflows');

        try {
            const stat = fs.statSync(pipelinesDir);
            if (!stat.isDirectory()) {
                return;
            }
        } catch {
            return;
        }

        this.registry.watch(
            workspaceId,
            pipelinesDir,
            (key, _changedFiles) => this.onWorkflowsChanged(key),
            {
                onError: (key) => this.registry.unwatch(key),
            },
        );
    }

    /**
     * Stop watching a workspace's workflows directory.
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
