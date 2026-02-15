/**
 * Wiki Manager
 *
 * Manages per-wiki runtime state (WikiData, ContextBuilder,
 * ConversationSessionManager, FileWatcher) with register/unregister
 * lifecycle.  Follows the TaskWatcher pattern — a Map-based registry
 * keyed by wiki ID.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { WikiData } from './wiki-data';
import { ContextBuilder } from './context-builder';
import { ConversationSessionManager } from './conversation-session-manager';
import { FileWatcher } from './file-watcher';
import type { AskAIFunction } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters for registering a wiki with the manager.
 */
export interface WikiRegistration {
    /** Unique identifier for this wiki */
    wikiId: string;
    /** Resolved path to the .wiki output directory */
    wikiDir: string;
    /** Original repo path (for FileWatcher + AI workingDirectory) */
    repoPath?: string;
    /** Whether AI Q&A is enabled for this wiki */
    aiEnabled: boolean;
    /** AI model override */
    aiModel?: string;
    /** Whether to watch the repo for changes */
    watch?: boolean;
    /** Debounce interval for file watching (ms) */
    watchDebounceMs?: number;
    /** Display title */
    title?: string;
    /** Theme preference */
    theme?: 'light' | 'dark' | 'auto';
}

/**
 * Runtime state for a single registered wiki.
 */
export interface WikiRuntime {
    registration: WikiRegistration;
    wikiData: WikiData;
    contextBuilder: ContextBuilder | null;
    sessionManager: ConversationSessionManager | null;
    fileWatcher: FileWatcher | null;
}

/**
 * Options for the WikiManager constructor.
 */
export interface WikiManagerOptions {
    /** AI send function shared across wikis */
    aiSendMessage?: AskAIFunction;
    /** Callback fired when wiki data is reloaded after file changes */
    onWikiReloaded?: (wikiId: string, affectedComponentIds: string[]) => void;
    /** Callback fired when a wiki-level error occurs */
    onWikiError?: (wikiId: string, error: Error) => void;
}

// ============================================================================
// WikiManager
// ============================================================================

export class WikiManager {
    private wikis = new Map<string, WikiRuntime>();
    private aiSendMessage: AskAIFunction | null;
    private onWikiReloaded: ((wikiId: string, affectedComponentIds: string[]) => void) | null;
    private onWikiError: ((wikiId: string, error: Error) => void) | null;

    constructor(options?: WikiManagerOptions) {
        this.aiSendMessage = options?.aiSendMessage ?? null;
        this.onWikiReloaded = options?.onWikiReloaded ?? null;
        this.onWikiError = options?.onWikiError ?? null;
    }

    /**
     * Register a wiki — loads WikiData eagerly, defers ContextBuilder.
     * Throws if the wikiDir is invalid.
     */
    register(registration: WikiRegistration): void {
        const resolvedDir = path.resolve(registration.wikiDir);

        // Validate directory exists
        if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
            throw new Error(`Wiki directory does not exist: ${resolvedDir}`);
        }

        // Validate component-graph.json exists
        const graphPath = path.join(resolvedDir, 'component-graph.json');
        if (!fs.existsSync(graphPath)) {
            throw new Error(`component-graph.json not found in wiki directory: ${resolvedDir}`);
        }

        // Load WikiData eagerly
        const wikiData = new WikiData(resolvedDir);
        try {
            wikiData.load();
        } catch (err) {
            throw new Error(
                `Failed to load wiki data for "${registration.wikiId}": ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        // If this wiki ID is already registered, unregister it first
        if (this.wikis.has(registration.wikiId)) {
            this.unregister(registration.wikiId);
        }

        // Create ConversationSessionManager if AI is enabled and sendMessage available
        let sessionManager: ConversationSessionManager | null = null;
        if (registration.aiEnabled && this.aiSendMessage) {
            sessionManager = new ConversationSessionManager({
                sendMessage: this.aiSendMessage,
            });
        }

        // Create FileWatcher if watch is enabled and repoPath is set
        let fileWatcher: FileWatcher | null = null;
        if (registration.watch && registration.repoPath) {
            try {
                fileWatcher = new FileWatcher({
                    repoPath: registration.repoPath,
                    wikiDir: resolvedDir,
                    componentGraph: wikiData.graph,
                    debounceMs: registration.watchDebounceMs,
                    onChange: (affectedIds) => {
                        this.reloadWikiData(registration.wikiId);
                        if (this.onWikiReloaded) {
                            this.onWikiReloaded(registration.wikiId, affectedIds);
                        }
                    },
                    onError: (err) => {
                        if (this.onWikiError) {
                            this.onWikiError(registration.wikiId, err);
                        }
                    },
                });
                fileWatcher.start();
            } catch {
                // FileWatcher start failures are non-fatal
                fileWatcher = null;
            }
        }

        const runtime: WikiRuntime = {
            registration: { ...registration, wikiDir: resolvedDir },
            wikiData,
            contextBuilder: null,
            sessionManager,
            fileWatcher,
        };

        this.wikis.set(registration.wikiId, runtime);
    }

    /**
     * Unregister a wiki — destroys sessions, stops watcher, removes from map.
     * @returns true if the wiki was found and removed.
     */
    unregister(wikiId: string): boolean {
        const runtime = this.wikis.get(wikiId);
        if (!runtime) {
            return false;
        }

        // Destroy conversation sessions
        runtime.sessionManager?.destroyAll();

        // Stop file watcher
        runtime.fileWatcher?.stop();

        // Remove from registry
        this.wikis.delete(wikiId);
        return true;
    }

    /**
     * Get runtime state for a wiki.
     */
    get(wikiId: string): WikiRuntime | undefined {
        return this.wikis.get(wikiId);
    }

    /**
     * Get all registered wiki IDs.
     */
    getRegisteredIds(): string[] {
        return Array.from(this.wikis.keys());
    }

    /**
     * Ensure ContextBuilder is initialized (lazy — called on first /api/ask).
     * Throws if the wiki is not registered or data is insufficient.
     */
    ensureContextBuilder(wikiId: string): ContextBuilder {
        const runtime = this.wikis.get(wikiId);
        if (!runtime) {
            throw new Error(`Wiki not registered: ${wikiId}`);
        }

        if (!runtime.contextBuilder) {
            const markdownData = runtime.wikiData.getMarkdownData();
            const themeMarkdownData = runtime.wikiData.getThemeMarkdownData();
            runtime.contextBuilder = new ContextBuilder(
                runtime.wikiData.graph,
                markdownData,
                themeMarkdownData,
            );
        }

        return runtime.contextBuilder;
    }

    /**
     * Reload wiki data from disk and invalidate the ContextBuilder.
     */
    reloadWikiData(wikiId: string): void {
        const runtime = this.wikis.get(wikiId);
        if (!runtime) {
            return;
        }

        runtime.wikiData.reload();
        // Invalidate cached ContextBuilder so next AI request rebuilds it
        runtime.contextBuilder = null;
    }

    /**
     * Dispose all wikis (server shutdown).
     */
    disposeAll(): void {
        for (const wikiId of Array.from(this.wikis.keys())) {
            this.unregister(wikiId);
        }
    }
}
