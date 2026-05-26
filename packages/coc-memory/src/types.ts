/**
 * CoC Memory — Core Types
 *
 * Defines all shared data shapes for the redesigned memory system:
 * facts, episodes, scopes, provenance, search, and feature flags.
 *
 * No Node.js or SQLite imports — pure TypeScript interfaces and enums.
 */

// ---------------------------------------------------------------------------
// Scope model
// ---------------------------------------------------------------------------

/**
 * Two-level scope for all memory items.
 *
 * - `global`    — default shared memory under `~/.coc/memory/global/`
 * - `workspace` — isolated per-workspace memory under
 *                 `~/.coc/repos/<workspaceId>/memory/`
 */
export type MemoryScope = 'global' | 'workspace';

// ---------------------------------------------------------------------------
// Fact types
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a stored fact.
 *
 * - `active`   — visible to recall and prompt injection
 * - `review`   — pending human approval (low-confidence or sensitive)
 * - `rejected` — dismissed from review; never recalled
 * - `archived` — soft-deleted; excluded from recall but preserved for export
 */
export type MemoryFactStatus = 'active' | 'review' | 'rejected' | 'archived';

/**
 * How a fact entered the system.
 */
export type MemoryFactSource = 'explicit' | 'auto-extracted' | 'imported';

/**
 * A single durable knowledge item.
 *
 * Facts represent stable reusable knowledge, preferences, conventions, and
 * environment/workflow lessons.
 */
export interface MemoryFact {
    /** Stable UUID assigned at creation */
    id: string;
    /** Scope determines which store holds this fact */
    scope: MemoryScope;
    /** Present only when scope === 'workspace' */
    workspaceId?: string;
    /** Plain-text fact content (no secrets or credentials) */
    content: string;
    /**
     * Importance weight in [0, 1].
     * Used during ranking to promote frequently-cited facts.
     */
    importance: number;
    /**
     * Extraction confidence in [0, 1].
     * Facts below the configured threshold go to review instead of active.
     */
    confidence: number;
    /** Current lifecycle status */
    status: MemoryFactStatus;
    /** Free-form string labels for filtering and grouping */
    tags: string[];
    /** How this fact was created */
    source: MemoryFactSource;
    /** Process that produced or triggered this fact, when known */
    sourceProcessId?: string;
    /** Zero-based turn index within the source process */
    sourceTurnIndex?: number;
    /** Ralph iteration number, when the source is a Ralph session */
    sourceRalphIteration?: number;
    /** ISO 8601 creation timestamp */
    createdAt: string;
    /** ISO 8601 last-update timestamp */
    updatedAt: string;
    /** Number of times this fact has been retrieved for a prompt */
    recalledCount: number;
    /** ISO 8601 timestamp of the most recent recall; undefined until first recall */
    lastRecalledAt?: string;
}

/**
 * Fields required to create a new fact.
 * `id`, `createdAt`, `updatedAt`, and `recalledCount` are set by the store.
 */
export type MemoryFactInput = Omit<MemoryFact, 'id' | 'createdAt' | 'updatedAt' | 'recalledCount'>;

// ---------------------------------------------------------------------------
// Episode types
// ---------------------------------------------------------------------------

/**
 * Kind of interaction that produced an episode.
 */
export type MemoryEpisodeEventType =
    | 'chat-turn'
    | 'ralph-iteration'
    | 'note-session'
    | 'commit-chat';

/**
 * Provenance metadata attached to every fact and episode.
 */
export interface MemoryProvenance {
    /** Agent that created this item */
    createdBy: 'user' | 'ai' | 'system';
    /** Human-readable description of the extraction source */
    extractedFrom?: string;
    /** Model that produced this item, when AI-generated */
    model?: string;
    /** Monotonically increasing version counter, incremented on each update */
    version: number;
}

/**
 * A compact record of a session or turn, linking back to the source process.
 *
 * Episodes are NOT full transcripts; they are summaries with provenance links.
 */
export interface MemoryEpisode {
    /** Stable UUID assigned at creation */
    id: string;
    /** Scope determines which store holds this episode */
    scope: MemoryScope;
    /** Present only when scope === 'workspace' */
    workspaceId?: string;
    /** ID of the CoC process (chat, Ralph, note, etc.) */
    processId: string;
    /** CoC session identifier when available */
    sessionId?: string;
    /** Ralph session ID when this episode is a Ralph iteration */
    ralphId?: string;
    /** Zero-based turn index within the process */
    turnIndex?: number;
    /** Ralph iteration number, when applicable */
    iterationIndex?: number;
    /** Short human-readable summary of what happened */
    summary: string;
    /** Kind of interaction that produced this episode */
    eventType: MemoryEpisodeEventType;
    /** ISO 8601 creation timestamp */
    createdAt: string;
    /** Provenance metadata */
    provenance: MemoryProvenance;
}

/**
 * Fields required to create a new episode.
 * `id` and `createdAt` are set by the store.
 */
export type MemoryEpisodeInput = Omit<MemoryEpisode, 'id' | 'createdAt'>;

// ---------------------------------------------------------------------------
// Search types
// ---------------------------------------------------------------------------

/**
 * Query object for searching facts.
 */
export interface MemorySearchQuery {
    /** Free-text query string for BM25 and/or vector search */
    text: string;
    /** Restrict results to a specific scope */
    scope?: MemoryScope;
    /** Workspace ID — required when scope is 'workspace' */
    workspaceId?: string;
    /** Filter to specific statuses; defaults to ['active'] */
    statuses?: MemoryFactStatus[];
    /** Filter to facts that include all of these tags */
    tags?: string[];
    /** Maximum results to return; defaults to 10 */
    limit?: number;
    /** Minimum combined rank score (0-1) to include */
    minScore?: number;
}

/**
 * A single search result entry.
 */
export interface MemorySearchResult {
    fact: MemoryFact;
    /** Combined rank score in [0, 1] */
    score: number;
    /** BM25 lexical score component */
    bm25Score: number;
    /** Vector similarity component; null when embeddings unavailable */
    vectorScore: number | null;
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

/** Filter for listing facts without a text query */
export interface MemoryFactFilter {
    scope?: MemoryScope;
    workspaceId?: string;
    statuses?: MemoryFactStatus[];
    tags?: string[];
    limit?: number;
    offset?: number;
}

/** Filter for listing episodes */
export interface MemoryEpisodeFilter {
    scope?: MemoryScope;
    workspaceId?: string;
    processId?: string;
    eventTypes?: MemoryEpisodeEventType[];
    limit?: number;
    offset?: number;
}

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Name of the admin/feature flag that gates the new memory system.
 * Must be `false` (disabled) by default.
 */
export const FEATURE_FLAG_COC_MEMORY = 'cocMemoryV2Enabled' as const;

/**
 * Default storage paths (relative to the CoC data dir).
 */
export const GLOBAL_MEMORY_SUBDIR = 'memory/global' as const;
export const WORKSPACE_MEMORY_SUBDIR = 'memory' as const;
