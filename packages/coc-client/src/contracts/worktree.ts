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
