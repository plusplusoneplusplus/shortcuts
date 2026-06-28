/**
 * Memory System Types
 *
 * Core type definitions shared by the bounded memory store and tool-call
 * cache subsystems.
 *
 * Pure Node.js types for pipeline-core.
 */

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

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
