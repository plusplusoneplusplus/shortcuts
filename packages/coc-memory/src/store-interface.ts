/**
 * Memory Store Interfaces
 *
 * Abstract contracts for the fact and episode stores.
 * Concrete implementations (SQLite) live in store-impl/ and are injected at
 * runtime by the CoC server. UI code never imports the concrete stores.
 */
import type {
    MemoryEpisode,
    MemoryEpisodeFilter,
    MemoryEpisodeInput,
    MemoryFact,
    MemoryFactFilter,
    MemoryFactInput,
    MemoryScope,
    MemorySearchQuery,
    MemorySearchResult,
} from './types';

// ---------------------------------------------------------------------------
// Fact store
// ---------------------------------------------------------------------------

/** Async persistence layer for MemoryFact items */
export interface IMemoryFactStore {
    /**
     * Persist a new fact and return it with server-assigned fields
     * (`id`, `createdAt`, `updatedAt`, `recalledCount`).
     */
    addFact(input: MemoryFactInput): Promise<MemoryFact>;

    /** Return the fact with the given id, or null if it does not exist. */
    getFact(id: string): Promise<MemoryFact | null>;

    /**
     * Apply partial updates to an existing fact.
     * Returns the updated fact, or null when the id is not found.
     * Always bumps `updatedAt` on success.
     */
    updateFact(id: string, updates: Partial<MemoryFact>): Promise<MemoryFact | null>;

    /**
     * Permanently delete a fact.
     * Returns true if the fact existed and was removed.
     */
    deleteFact(id: string): Promise<boolean>;

    /**
     * Full-text (BM25) and/or vector search over active facts.
     * Falls back to BM25-only when no embedding provider is available.
     */
    searchFacts(query: MemorySearchQuery): Promise<MemorySearchResult[]>;

    /**
     * List facts matching the optional filter without a text query.
     * Useful for browsing the review queue, tag filtering, etc.
     */
    listFacts(filter?: MemoryFactFilter): Promise<MemoryFact[]>;

    /**
     * Record a recall event: increment `recalledCount` and set `lastRecalledAt`.
     * Called after facts are injected into a prompt.
     */
    recordRecall(ids: string[]): Promise<void>;

    /**
     * Permanently delete all facts for the given scope.
     * - scope = 'global'    → deletes all global facts
     * - scope = 'workspace' → deletes only facts for workspaceId (required)
     * Never touches facts outside the specified scope.
     */
    wipe(scope: MemoryScope, workspaceId?: string): Promise<void>;

    /**
     * Export all facts for the given scope as a portable JSON array.
     * Used for the export/backup feature.
     */
    exportFacts(scope: MemoryScope, workspaceId?: string): Promise<MemoryFact[]>;
}

// ---------------------------------------------------------------------------
// Episode store
// ---------------------------------------------------------------------------

/** Async persistence layer for MemoryEpisode items */
export interface IMemoryEpisodeStore {
    /**
     * Persist a new episode and return it with server-assigned fields
     * (`id`, `createdAt`).
     */
    addEpisode(input: MemoryEpisodeInput): Promise<MemoryEpisode>;

    /** Return the episode with the given id, or null if it does not exist. */
    getEpisode(id: string): Promise<MemoryEpisode | null>;

    /** List episodes matching the optional filter. */
    listEpisodes(filter?: MemoryEpisodeFilter): Promise<MemoryEpisode[]>;

    /**
     * Permanently delete all episodes for the given scope.
     * Never touches episodes outside the specified scope.
     */
    wipe(scope: MemoryScope, workspaceId?: string): Promise<void>;

    /**
     * Export all episodes for the given scope as a portable JSON array.
     */
    exportEpisodes(scope: MemoryScope, workspaceId?: string): Promise<MemoryEpisode[]>;
}

// ---------------------------------------------------------------------------
// Combined store handle
// ---------------------------------------------------------------------------

/** Convenience handle grouping both stores for a single scope resolution */
export interface MemoryStoreHandle {
    facts: IMemoryFactStore;
    episodes: IMemoryEpisodeStore;
}
