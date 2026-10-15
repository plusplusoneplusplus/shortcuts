/**
 * Watches a repository directory for changes and triggers incremental
 * rebuilds from native, debounced path batches.
 */

import * as path from 'path';
import type { ComponentGraph } from './types';
import { getNativeWatchService, type NativeWatchServiceLike } from '../shared/native-watch-service';

// ============================================================================
// Types
// ============================================================================

export interface FileWatcherOptions {
    /** Workspace that owns this subscription */
    workspaceId: string;
    watchService?: NativeWatchServiceLike;
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
}

/** Default debounce interval in milliseconds */
const DEFAULT_DEBOUNCE_MS = 2000;

// ============================================================================
// FileWatcher
// ============================================================================

export class FileWatcher {
    private watchService: NativeWatchServiceLike;
    private subscriptionId?: number;
    private generation = 0;
    private options: FileWatcherOptions;

    constructor(options: FileWatcherOptions) {
        this.options = options;
        this.watchService = options.watchService ?? getNativeWatchService();
    }

    /**
     * Start watching the repository for changes.
     */
    start(): void {
        if (this.isWatching) return;
        const generation = ++this.generation;
        this.subscriptionId = this.watchService.subscribe({
            workspaceId: this.options.workspaceId,
            root: path.resolve(this.options.repoPath),
            recursive: true,
            ignoreDirs: IGNORE_PATTERNS,
            extensions: [],
            respectGitignore: true,
            debounceMs: this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
        }, batch => {
            if (generation !== this.generation) return;
            const affectedIds = batch.rescan
                ? this.options.componentGraph.components.map(component => component.id)
                : this.findAffectedComponents(batch.paths.filter(filename => !shouldIgnore(filename)));
            if (batch.rescan || affectedIds.length > 0) {
                this.options.onChange(affectedIds);
            }
        });
    }

    /**
     * Stop watching.
     */
    stop(): void {
        this.generation++;
        if (this.subscriptionId !== undefined) this.watchService.unsubscribe(this.subscriptionId);
        this.subscriptionId = undefined;
    }

    /**
     * Whether the watcher is currently active.
     */
    get isWatching(): boolean {
        return this.subscriptionId !== undefined;
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
