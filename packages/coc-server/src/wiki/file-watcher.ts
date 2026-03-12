/**
 * File Watcher
 *
 * Watches a repository directory for changes and triggers incremental
 * rebuilds. Uses fs.watch (recursive) with debouncing to avoid
 * excessive rebuilds during rapid file saves.
 *
 * When changes are detected:
 * 1. Debounce for 2 seconds
 * 2. Determine which components are affected
 * 3. Notify callback with affected component IDs
 */

import * as path from 'path';
import type { ComponentGraph } from './types';
import { DebouncedWatcherRegistry } from '../shared/debounced-watcher-registry';

// ============================================================================
// Types
// ============================================================================

export interface FileWatcherOptions {
    /** Path to the repository to watch */
    repoPath: string;
    /** Wiki output directory (to reload data after rebuild) */
    wikiDir: string;
    /** Component graph for determining affected components */
    componentGraph: ComponentGraph;
    /** Debounce interval in milliseconds (default: 2000) */
    debounceMs?: number;
    /** Callback when changes are detected */
    onChange: (affectedComponentIds: string[]) => void;
    /** Optional callback for errors */
    onError?: (error: Error) => void;
}

/** Default debounce interval in milliseconds */
const DEFAULT_DEBOUNCE_MS = 2000;

// ============================================================================
// FileWatcher
// ============================================================================

/** Fixed key used by FileWatcher for its single-directory watcher. */
const WATCHER_KEY = 'default';

export class FileWatcher {
    private registry: DebouncedWatcherRegistry<typeof WATCHER_KEY>;
    private options: FileWatcherOptions;

    constructor(options: FileWatcherOptions) {
        this.options = options;
        this.registry = new DebouncedWatcherRegistry(options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    }

    /**
     * Start watching the repository for changes.
     */
    start(): void {
        if (this.registry.isWatching(WATCHER_KEY)) return;

        const { repoPath } = this.options;

        this.registry.watch(
            WATCHER_KEY,
            repoPath,
            (_key, changedFiles) => {
                const affectedIds = this.findAffectedComponents(changedFiles);
                if (affectedIds.length > 0) {
                    this.options.onChange(affectedIds);
                }
            },
            {
                shouldIgnore,
                onError: (_key, err) => {
                    this.options.onError?.(err);
                },
            },
        );
    }

    /**
     * Stop watching.
     */
    stop(): void {
        this.registry.unwatch(WATCHER_KEY);
    }

    /**
     * Whether the watcher is currently active.
     */
    get isWatching(): boolean {
        return this.registry.isWatching(WATCHER_KEY);
    }

    // ========================================================================
    // Private
    // ========================================================================

    /**
     * Determine which components are affected by the changed files.
     *
     * A component is affected if any changed file is within the component's path.
     */
    private findAffectedComponents(changedFiles: string[]): string[] {
        const affected = new Set<string>();

        for (const file of changedFiles) {
            const normalizedFile = file.replace(/\\/g, '/');

            for (const mod of this.options.componentGraph.components) {
                const componentPath = mod.path.replace(/\\/g, '/');

                // Check if the changed file is within the component's directory
                if (normalizedFile.startsWith(componentPath + '/') || normalizedFile === componentPath) {
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
