/**
 * Git worktree execution contracts.
 *
 * Opt-in request the dashboard sends on Work Item / Ralph execution launches so
 * the target CoC server runs the work inside an isolated Git worktree instead of
 * the selected workspace's current checkout. Gated by the
 * `features.gitWorktreeExecution` admin flag (surfaced to the SPA as the
 * `gitWorktreeExecutionEnabled` runtime capability flag).
 */

/**
 * Opt-in worktree request embedded in an execution launch body under the
 * `worktree` key. Omitting the key preserves existing (non-worktree) behavior.
 */
export interface WorktreeExecutionRequest {
    /** Always `true` — the request only exists to opt in. */
    enabled: true;
    /**
     * Optional base ref/branch/SHA to create the worktree from. When omitted
     * (or empty), the worktree is based on the workspace's current `HEAD`.
     * Must resolve locally on the target server (validated server-side).
     */
    baseRef?: string;
}

/** Lifecycle status of a CoC-created worktree record. */
export type WorktreeStatus =
    /** The worktree checkout exists on disk and can back a run. */
    | 'active'
    /** The checkout was removed via cleanup; the record is kept for history. */
    | 'cleaned';

/**
 * Persisted metadata describing a single CoC-created Git worktree.
 *
 * Recorded by the target server that created the worktree (under the repo-scoped
 * data root) and echoed onto the linked queued process metadata and/or Ralph
 * session record so resume/continue/final-check and the dashboard chip can
 * recover the worktree without re-deriving it. The `branch` is never deleted
 * automatically — cleanup only removes the checkout (`status: 'cleaned'`).
 */
export interface WorktreeMetadata {
    /** Stable id for this worktree run (the session or task id it backs). */
    id: string;
    /** Workspace whose checkout this worktree was branched from. */
    workspaceId: string;
    /** Absolute path to the isolated worktree checkout on the target server. */
    path: string;
    /** Dedicated branch created for this run, e.g. `coc/<slug>-<short-id>`. */
    branch: string;
    /**
     * The base ref/branch/SHA the user requested, if any. Omitted when the
     * worktree was based on the workspace's current `HEAD`.
     */
    baseRef?: string;
    /** Resolved commit SHA the worktree branch was created from. */
    baseSha: string;
    /** ISO timestamp when the worktree was created. */
    createdAt: string;
    /**
     * Whether the source checkout had uncommitted changes when the worktree
     * was created. Those changes are intentionally excluded from the worktree.
     */
    sourceDirty: boolean;
    /** Human-facing warning surfaced when `sourceDirty` is true. */
    sourceDirtyWarning?: string;
    /** Linked queued process id, when the worktree backs a Work Item run. */
    processId?: string;
    /** Linked Ralph session id, when the worktree backs a Ralph session. */
    ralphSessionId?: string;
    /** Lifecycle status; `cleaned` once the checkout has been removed. */
    status: WorktreeStatus;
    /** ISO timestamp when the checkout was removed via cleanup, if cleaned. */
    cleanedAt?: string;
}

/**
 * Response of `GET /api/workspaces/:workspaceId/worktrees` — the CoC-created
 * worktree records for a single workspace, newest first. Scoped strictly to the
 * requested workspace (never mixes records across workspaces or remote targets).
 */
export interface ListWorktreesResponse {
    worktrees: WorktreeMetadata[];
}

/**
 * Response of `POST /api/workspaces/:workspaceId/worktrees/:id/cleanup` — the
 * updated worktree record after a non-destructive `git worktree remove`. The
 * generated branch is preserved; only the checkout is removed and the record is
 * marked `cleaned`. `alreadyCleaned` is `true` when the record was cleaned
 * already (idempotent no-op).
 */
export interface CleanupWorktreeResponse {
    worktree: WorktreeMetadata;
    alreadyCleaned: boolean;
}
