/**
 * File Watcher
 *
 * Watches a repository directory for changes and triggers incremental
 * rebuilds. Uses fs.watch (recursive) with debouncing to avoid
 * excessive rebuilds during rapid file saves.
 *
 * When changes are detected:
 * 1. Debounce for 2 seconds
 * 2. Determine which modules are affected
 * 3. Notify callback with affected module IDs
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ModuleGraph } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface FileWatcherOptions {
    /** Path to the repository to watch */
    repoPath: string;
    /** Wiki output directory (to reload data after rebuild) */
    wikiDir: string;
    /** Module graph for determining affected modules */
    moduleGraph: ModuleGraph;
    /** Debounce interval in milliseconds (default: 2000) */
    debounceMs?: number;
    /** Callback when changes are detected */
    onChange: (affectedModuleIds: string[]) => void;
    /** Optional callback for errors */
    onError?: (error: Error) => void;
}

// ============================================================================
// FileWatcher
// ============================================================================

export class FileWatcher {
    private watcher: fs.FSWatcher | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private changedFiles: Set<string> = new Set();
    private options: FileWatcherOptions;
    private _isWatching = false;

    constructor(options: FileWatcherOptions) {
        this.options = options;
    }

    /**
     * Start watching the repository for changes.
     */
    start(): void {
        if (this._isWatching) return;

        const { repoPath, debounceMs = 2000 } = this.options;

        try {
            this.watcher = fs.watch(repoPath, { recursive: true }, (eventType, filename) => {
                if (!filename) return;

                // Ignore common non-source files
                if (shouldIgnore(filename)) return;

                this.changedFiles.add(filename);

                // Debounce
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                this.debounceTimer = setTimeout(() => {
                    this.processChanges();
                }, debounceMs);
            });

            this.watcher.on('error', (err) => {
                if (this.options.onError) {
                    this.options.onError(err instanceof Error ? err : new Error(String(err)));
                }
            });

            this._isWatching = true;
        } catch (err) {
            if (this.options.onError) {
                this.options.onError(err instanceof Error ? err : new Error(String(err)));
            }
        }
    }

    /**
     * Stop watching.
     */
    stop(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.changedFiles.clear();
        this._isWatching = false;
    }

    /**
     * Whether the watcher is currently active.
     */
    get isWatching(): boolean {
        return this._isWatching;
    }

    // ========================================================================
    // Private
    // ========================================================================

    private processChanges(): void {
        const files = Array.from(this.changedFiles);
        this.changedFiles.clear();

        // Determine which modules are affected
        const affectedIds = this.findAffectedModules(files);

        if (affectedIds.length > 0) {
            this.options.onChange(affectedIds);
        }
    }

    /**
     * Determine which modules are affected by the changed files.
     *
     * A module is affected if any changed file is within the module's path.
     */
    private findAffectedModules(changedFiles: string[]): string[] {
        const affected = new Set<string>();

        for (const file of changedFiles) {
            const normalizedFile = file.replace(/\\/g, '/');

            for (const mod of this.options.moduleGraph.modules) {
                const modulePath = mod.path.replace(/\\/g, '/');

                // Check if the changed file is within the module's directory
                if (normalizedFile.startsWith(modulePath + '/') || normalizedFile === modulePath) {
                    affected.add(mod.id);
                    continue;
                }

                // Also check key files
                for (const keyFile of mod.keyFiles) {
                    const normalizedKeyFile = keyFile.replace(/\\/g, '/');
                    if (normalizedFile === normalizedKeyFile || normalizedFile.endsWith('/' + normalizedKeyFile)) {
                        affected.add(mod.id);
                        break;
                    }
                }
            }
        }

        return Array.from(affected);
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Patterns to ignore (node_modules, .git, build artifacts, etc.)
 */
const IGNORE_PATTERNS = [
    'node_modules',
    '.git',
    '.wiki-cache',
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    '__pycache__',
    '.pytest_cache',
    '.tox',
    'target',
    '.DS_Store',
    'thumbs.db',
    '.env',
];

function shouldIgnore(filename: string): boolean {
    const normalized = filename.replace(/\\/g, '/');
    const parts = normalized.split('/');

    for (const part of parts) {
        if (IGNORE_PATTERNS.includes(part)) return true;
    }

    // Ignore common generated/temp files
    if (normalized.endsWith('.map') ||
        normalized.endsWith('.lock') ||
        normalized.endsWith('.log')) {
        return true;
    }

    return false;
}
