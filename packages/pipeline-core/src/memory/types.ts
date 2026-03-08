/**
 * Memory System Types
 *
 * Type definitions for the CoC memory system — persistence layer that lets
 * AI pipelines learn from past executions. Defines storage schemas, config
 * shapes, and the MemoryStore public API contract.
 *
 * No VS Code dependencies — pure Node.js types for pipeline-core.
 */

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/**
 * YAML frontmatter metadata for a raw observation file stored in `raw/`.
 * Filename pattern: `<timestamp>-<pipeline-id>.md`
 */
export interface RawObservationMetadata {
    /** Pipeline name that produced this observation (e.g. "code-review") */
    pipeline: string;
    /** ISO 8601 timestamp of when the observation was captured */
    timestamp: string;
    /** Repository identifier (e.g. "github/shortcuts") */
    repo?: string;
    /** AI model used for the pipeline run */
    model?: string;
}

/**
 * Full raw observation file content (metadata + body).
 */
export interface RawObservation {
    /** Frontmatter metadata */
    metadata: RawObservationMetadata;
    /** Markdown body — bullet list of facts */
    content: string;
    /** Filename (e.g. "20260228T150000Z-code-review.md") */
    filename: string;
}

/**
 * Parsed representation of `consolidated.md`.
 *
 * Intentionally simple for v1 — just the raw markdown string.
 * Section parsing can be added later if selective retrieval needs it.
 */
export interface ConsolidatedMemory {
    /** Raw markdown content of the consolidated file */
    content: string;
    /** ISO 8601 timestamp when this consolidation was last written */
    lastUpdated?: string;
}

/**
 * Maps 1:1 to `index.json` on disk. Tracks aggregation state and
 * summary statistics for a memory level.
 */
export interface MemoryIndex {
    /** ISO 8601 timestamp of last aggregation run */
    lastAggregation: string | null;
    /** Number of unprocessed raw observation files */
    rawCount: number;
    /** Number of facts in consolidated memory */
    factCount: number;
    /** Topic categories present in consolidated memory */
    categories: string[];
}

/**
 * Maps 1:1 to `repo-info.json` inside each `repos/<hash>/` directory.
 * Identifies and describes a tracked repository.
 */
export interface RepoInfo {
    /** Absolute path to the repository root */
    path: string;
    /** Human-readable repo name (e.g. "shortcuts") */
    name: string;
    /** Git remote URL (origin), if available */
    remoteUrl?: string;
    /** ISO 8601 timestamp of last memory access for this repo */
    lastAccessed: string;
}

/**
 * Maps 1:1 to `remote-info.json` inside each `git-remotes/<hash>/` directory.
 * Identifies a tracked git remote.
 */
export interface GitRemoteInfo {
    /** Normalised remote URL (e.g. "https://github.com/owner/repo") */
    remoteUrl: string;
    /** Human-readable name derived from URL (e.g. "owner/repo") */
    name: string;
    /** ISO 8601 timestamp of last memory access for this remote */
    lastAccessed: string;
}

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * String-literal union for the two memory isolation levels plus both.
 *
 * - `'repo'`       — per-repository memory under `repos/<hash>/`
 * - `'system'`     — global memory under `system/`
 * - `'git-remote'` — per-git-remote memory under `git-remotes/<hash>/`
 * - `'both'`       — operate on both system and repo levels
 */
export type MemoryLevel = 'repo' | 'system' | 'git-remote' | 'both';

/**
 * Schema for the `memory` field in pipeline YAML.
 *
 * Supports both `memory: true` (shorthand, normalized by the YAML parser)
 * and the granular object form.
 */
export interface MemoryConfig {
    /** Whether to inject consolidated memory into prompts before AI calls */
    retrieve: boolean;
    /** Whether to capture observations after AI calls */
    capture: boolean;
    /** Which memory level(s) to read/write. Default: 'both' */
    level: MemoryLevel;
}

/**
 * Constructor options for the MemoryStore implementation.
 * Follows the `FileProcessStoreOptions` pattern.
 */
export interface MemoryStoreOptions {
    /** Root directory for all memory data. Default: ~/.coc/memory */
    dataDir?: string;
}

/**
 * Return type for the per-level `getStats()` method.
 * Provides a snapshot of memory state at a single level.
 */
export interface MemoryStats {
    /** Number of raw observation files at this level */
    rawCount: number;
    /** Whether consolidated.md exists at this level */
    consolidatedExists: boolean;
    /** ISO 8601 timestamp of last aggregation, or null if never aggregated */
    lastAggregation: string | null;
    /** Number of facts in consolidated memory (from index.json) */
    factCount: number;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/**
 * Public API contract for the memory persistence layer.
 *
 * All I/O methods return Promises. The `level` + `repoHash` pattern lets
 * callers target system memory, repo-scoped memory, or both without
 * separate method pairs.
 */
export interface MemoryStore {
    // --- Raw observations ---

    /** Write a new raw observation file. Returns the generated filename. */
    writeRaw(
        level: MemoryLevel,
        repoHash: string | undefined,
        metadata: RawObservationMetadata,
        content: string,
    ): Promise<string>;

    /** List raw observation filenames, newest first. */
    listRaw(
        level: MemoryLevel,
        repoHash: string | undefined,
    ): Promise<string[]>;

    /** Read a single raw observation by filename. */
    readRaw(
        level: MemoryLevel,
        repoHash: string | undefined,
        filename: string,
    ): Promise<RawObservation | undefined>;

    /** Delete a raw observation file by filename. Returns true if deleted. */
    deleteRaw(
        level: MemoryLevel,
        repoHash: string | undefined,
        filename: string,
    ): Promise<boolean>;

    // --- Consolidated memory ---

    /** Read consolidated memory as raw markdown string. Returns null if no consolidation has run. */
    readConsolidated(
        level: MemoryLevel,
        repoHash?: string,
    ): Promise<string | null>;

    /** Write consolidated memory (atomic: tmp → rename). */
    writeConsolidated(
        level: MemoryLevel,
        content: string,
        repoHash?: string,
    ): Promise<void>;

    // --- Index ---

    /** Read the memory index. Returns a default index if none exists. */
    readIndex(
        level: MemoryLevel,
        repoHash: string | undefined,
    ): Promise<MemoryIndex>;

    /** Update the memory index (partial merge). */
    updateIndex(
        level: MemoryLevel,
        repoHash: string | undefined,
        updates: Partial<MemoryIndex>,
    ): Promise<void>;

    // --- Repo info ---

    /** Get repo info for a repo hash. Returns null if repo not registered. */
    getRepoInfo(repoHash: string): Promise<RepoInfo | null>;

    /** Create or update repo info for a repo hash (partial merge). */
    updateRepoInfo(repoHash: string, info: Partial<RepoInfo>): Promise<void>;

    /** Compute a stable hash for a repository root path. Pure function (no I/O). */
    computeRepoHash(repoPath: string): string;

    // --- Git remote info ---

    /** Get git remote info for a remote hash. Returns null if not registered. */
    getGitRemoteInfo(remoteHash: string): Promise<GitRemoteInfo | null>;

    /** Create or update git remote info for a remote hash (partial merge). */
    updateGitRemoteInfo(remoteHash: string, info: Partial<GitRemoteInfo>): Promise<void>;

    /** List all git remote hashes that have memory stored. */
    listGitRemotes(): Promise<string[]>;

    // --- Management ---

    /** Clear memory at the given level. If rawOnly=true, keeps consolidated.md and index.json. */
    clear(level: MemoryLevel, repoHash?: string, rawOnly?: boolean): Promise<void>;

    /** Return statistics for a specific memory level. */
    getStats(level: MemoryLevel, repoHash?: string): Promise<MemoryStats>;

    /** List all repo hashes that have memory stored. */
    listRepos(): Promise<string[]>;

    // --- Path helpers ---

    /** Get the absolute path to the system memory directory. */
    getSystemDir(): string;

    /** Get the absolute path to a repo's memory directory. */
    getRepoDir(repoHash: string): string;

    /** Get the absolute path to a git remote's memory directory. */
    getGitRemoteDir(remoteHash: string): string;
}
