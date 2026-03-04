/**
 * Tool Call Cache Types
 *
 * Type definitions for the tool-call caching system — captures raw tool-call
 * Q&A entries, consolidated summaries, and cache index metadata. Follows the
 * same patterns as the memory system's types.ts.
 *
 * No VS Code dependencies — pure Node.js types for pipeline-core.
 */

import { MemoryLevel } from './types';

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Predicate to decide which tool calls should be cached.
 * Return true to cache the call, false to skip.
 */
export type ToolCallFilter = (toolName: string, args: Record<string, unknown>) => boolean;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/**
 * Raw Q&A entry stored as individual JSON files under `explore-cache/raw/`.
 * Filename pattern: `<timestamp_ms>-<sanitized_toolName>.json`
 */
export interface ToolCallQAEntry {
    /** Unique identifier (uuid v4 or timestamp-based) */
    id: string;
    /** Name of the tool that was called (e.g. "grep", "view", "glob") */
    toolName: string;
    /** Normalized question/description derived from the tool call args */
    question: string;
    /** The tool's response/output */
    answer: string;
    /** Original arguments passed to the tool */
    args: Record<string, unknown>;
    /** Git HEAD hash at time of capture, for staleness detection */
    gitHash?: string;
    /** ISO 8601 timestamp of when this entry was captured */
    timestamp: string;
    /** ID of the parent tool call if this was a nested/chained call */
    parentToolCallId?: string;
}

/**
 * Maps 1:1 to `explore-cache/index.json` on disk. Tracks aggregation state
 * and summary statistics for the cache.
 */
export interface ToolCallCacheIndex {
    /** ISO 8601 timestamp of last aggregation/consolidation run */
    lastAggregation: string | null;
    /** Number of unprocessed raw Q&A files */
    rawCount: number;
    /** Number of entries in consolidated.json */
    consolidatedCount: number;
    /** Git HEAD hash at time of last aggregation */
    gitHash?: string;
}

/**
 * Consolidated/deduplicated entry produced by the aggregator. Stored in
 * `explore-cache/consolidated.json` as an array.
 */
export interface ConsolidatedToolCallEntry {
    /** Unique identifier for the consolidated entry */
    id: string;
    /** Normalized question (may be a merged/generalized form of multiple raw questions) */
    question: string;
    /** Consolidated answer (may be summarized from multiple raw answers) */
    answer: string;
    /** Topic tags for retrieval filtering (e.g. ["architecture", "testing"]) */
    topics: string[];
    /** Git hash when this entry was last updated */
    gitHash?: string;
    /** Tool names that contributed to this entry */
    toolSources: string[];
    /** ISO 8601 timestamp when this entry was first created */
    createdAt: string;
    /** Number of times this entry has been used for context injection */
    hitCount: number;
}

// ---------------------------------------------------------------------------
// Retrieval types
// ---------------------------------------------------------------------------

/** Strategy for handling stale cache entries */
export type StalenessStrategy = 'skip' | 'warn' | 'revalidate';

/** Result of a cache lookup — returned by ToolCallCacheRetriever.lookup() */
export interface ToolCallCacheLookupResult {
    /** The matched consolidated entry */
    entry: ConsolidatedToolCallEntry;
    /** Similarity score between 0 and 1 */
    score: number;
    /** Whether the entry is stale (gitHash mismatch) */
    stale: boolean;
}

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * Configuration shape for the `toolCallCache` field in pipeline YAML or
 * runtime options. Reuses `MemoryLevel` from types.ts.
 */
export interface ToolCallCacheConfig {
    /** Whether the cache is enabled */
    enabled: boolean;
    /** Optional filter to select which tool calls to cache */
    filter?: ToolCallFilter;
    /** Memory level to scope caching (reuse existing MemoryLevel) */
    level: MemoryLevel;
}

/**
 * Constructor options for the ToolCallCacheStore implementation.
 */
export interface ToolCallCacheStoreOptions {
    /** Root directory for all memory data. Default: ~/.coc/memory */
    dataDir?: string;
    /** Subdirectory name under dataDir for cache data. Default: 'explore-cache' */
    cacheSubDir?: string;
}

/**
 * Return type for `getStats()`. Provides a snapshot of cache state.
 */
export interface ToolCallCacheStats {
    /** Number of raw Q&A files */
    rawCount: number;
    /** Whether consolidated.json exists */
    consolidatedExists: boolean;
    /** Number of entries in consolidated.json */
    consolidatedCount: number;
    /** ISO 8601 timestamp of last aggregation, or null */
    lastAggregation: string | null;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/**
 * Public API contract for the tool-call cache persistence layer.
 *
 * All I/O methods return Promises. Unlike MemoryStore, no level/repoHash
 * routing — the cache operates on a single directory.
 */
export interface ToolCallCacheStore {
    // --- Raw Q&A entries ---

    /** Write a new raw Q&A entry. Returns the generated filename. */
    writeRaw(entry: ToolCallQAEntry): Promise<string>;

    /** Read a single raw Q&A entry by filename. Returns undefined if not found. */
    readRaw(filename: string): Promise<ToolCallQAEntry | undefined>;

    /** List raw Q&A filenames, newest first. */
    listRaw(): Promise<string[]>;

    /** Delete a raw Q&A file by filename. Returns true if deleted. */
    deleteRaw(filename: string): Promise<boolean>;

    // --- Consolidated entries ---

    /** Read consolidated entries. Returns empty array if no file exists. */
    readConsolidated(): Promise<ConsolidatedToolCallEntry[]>;

    /** Write consolidated entries (atomic: tmp → rename). */
    writeConsolidated(entries: ConsolidatedToolCallEntry[]): Promise<void>;

    // --- Index ---

    /** Read the cache index. Returns defaults if none exists. */
    readIndex(): Promise<ToolCallCacheIndex>;

    /** Update the cache index (partial merge). */
    updateIndex(updates: Partial<ToolCallCacheIndex>): Promise<void>;

    // --- Management ---

    /** Return statistics snapshot of the cache. */
    getStats(): Promise<ToolCallCacheStats>;

    /** Remove the entire cache directory. */
    clear(): Promise<void>;
}
