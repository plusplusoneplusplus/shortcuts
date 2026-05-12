/**
 * Unified diff provider types.
 *
 * Defines the canonical types for the `IDiffProvider` abstraction that
 * unifies five diff source kinds: single commit, commit range,
 * working tree, pull request, and pull request iteration.
 */

import type { GitChangeStatus } from '../git/types';

// ── Diff source discriminant ─────────────────────────────────

/**
 * The five supported diff source kinds.
 *
 * - `commit`        — single commit vs its parent
 * - `range`         — commit range (e.g. feature branch vs origin/main)
 * - `working-tree`  — staged + unstaged changes in the working tree
 * - `pr`            — pull request (latest state from remote provider)
 * - `pr-iteration`  — a specific iteration/revision of a pull request
 */
export type DiffSourceKind =
    | 'commit'
    | 'range'
    | 'working-tree'
    | 'pr'
    | 'pr-iteration';

// ── Diff file entry (eager-loaded file list) ─────────────────

/**
 * A file entry in the diff, returned as part of the eager file list.
 * Diff content is loaded lazily via `IDiffProvider.getFileDiff()`.
 */
export interface DiffFileEntry {
    /** Relative path to the file within the repository. */
    path: string;
    /** Original path before rename/copy (only set for renames/copies). */
    originalPath?: string;
    /** Type of change. */
    status: GitChangeStatus;
    /** Lines added (when available from the source). */
    additions?: number;
    /** Lines deleted (when available from the source). */
    deletions?: number;
    /** Whether the file is binary. */
    isBinary?: boolean;
}

// ── Diff content ─────────────────────────────────────────────

/**
 * The diff content for a single file, returned by `getFileDiff()`.
 */
export interface DiffContent {
    /** Raw unified diff string (git diff format). */
    raw: string;
    /** Whether the diff was truncated (e.g. by server-side limits). */
    truncated: boolean;
    /** Total line count of the raw diff before truncation. */
    totalLines: number;
}

// ── Diff summary (aggregate stats) ───────────────────────────

/**
 * Aggregate statistics for the entire diff.
 */
export interface DiffSummary {
    /** Total files changed. */
    filesChanged: number;
    /** Total lines added across all files. */
    additions: number;
    /** Total lines deleted across all files. */
    deletions: number;
}

// ── Source descriptors (discriminated union) ──────────────────

interface DiffSourceBase {
    kind: DiffSourceKind;
    /** Repository root (absolute path for local, identifier for remote). */
    repositoryRoot: string;
}

export interface CommitDiffSource extends DiffSourceBase {
    kind: 'commit';
    /** The commit hash. */
    commitHash: string;
}

export interface RangeDiffSource extends DiffSourceBase {
    kind: 'range';
    /** Base ref (e.g. origin/main). */
    baseRef: string;
    /** Head ref (e.g. HEAD or branch name). */
    headRef: string;
}

export interface WorkingTreeDiffSource extends DiffSourceBase {
    kind: 'working-tree';
    /** Which working tree changes to include. */
    scope: 'all' | 'staged' | 'unstaged';
}

export interface PullRequestDiffSource extends DiffSourceBase {
    kind: 'pr';
    /** Provider type for the pull request. */
    provider: 'ado' | 'github';
    /** Repository identifier on the remote provider. */
    remoteRepositoryId: string;
    /** Pull request ID. */
    pullRequestId: number | string;
}

export interface PullRequestIterationDiffSource extends DiffSourceBase {
    kind: 'pr-iteration';
    /** Provider type for the pull request. */
    provider: 'ado' | 'github';
    /** Repository identifier on the remote provider. */
    remoteRepositoryId: string;
    /** Pull request ID. */
    pullRequestId: number | string;
    /** Iteration/revision number. */
    iterationId: number;
    /** Optional base iteration for inter-iteration diffs. */
    baseIterationId?: number;
}

/**
 * Discriminated union of all diff source descriptors.
 * Passed to factory functions and stored on the provider for introspection.
 */
export type DiffSource =
    | CommitDiffSource
    | RangeDiffSource
    | WorkingTreeDiffSource
    | PullRequestDiffSource
    | PullRequestIterationDiffSource;

// ── IDiffProvider interface ──────────────────────────────────

/**
 * Unified interface for retrieving diffs from any source.
 *
 * **Hybrid loading strategy:**
 * - `listFiles()` returns the file list eagerly (cheap metadata query).
 * - `getFileDiff()` returns the diff content for one file lazily (on demand).
 * - `prefetchAll()` eagerly loads all file diffs in one batch (for AI review).
 * - `getFullDiff()` returns the combined diff for all files.
 */
export interface IDiffProvider {
    /** The source descriptor for this provider instance. */
    readonly source: DiffSource;

    /**
     * List all files in this diff.
     * This is the "eager" part — typically a cheap metadata query.
     */
    listFiles(): Promise<DiffFileEntry[]>;

    /**
     * Get the diff content for a single file.
     * This is the "lazy" part — fetched on demand.
     *
     * @param filePath - Relative path of the file (as returned by `listFiles()`).
     * @param options  - Optional settings.
     */
    getFileDiff(filePath: string, options?: GetFileDiffOptions): Promise<DiffContent>;

    /**
     * Get the combined diff for all files.
     * For local sources this is a single `git diff` call.
     * For remote sources this may be synthesized from per-file diffs.
     */
    getFullDiff(): Promise<DiffContent>;

    /**
     * Eagerly fetch all file diffs in a single batch.
     * Returns the same data as calling `getFileDiff()` for every file,
     * but may be significantly faster (single git call or batched API request).
     *
     * The returned map is keyed by file path.
     */
    prefetchAll(): Promise<Map<string, DiffContent>>;

    /**
     * Get aggregate statistics for the diff.
     */
    getSummary(): Promise<DiffSummary>;
}

// ── Options ──────────────────────────────────────────────────

export interface GetFileDiffOptions {
    /**
     * When true, returns the full diff without server-side truncation.
     * Default: false.
     */
    full?: boolean;
}
