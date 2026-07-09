/**
 * Shared helpers for opt-in Git worktree execution on Ralph launch surfaces.
 *
 * Used by:
 *   - POST /api/ralph-launch          (direct goal launch / new Ralph launch)
 *   - POST /api/processes/:id/ralph-start (promoted grilling-phase start)
 *
 * The target server creates the worktree for its *own* workspace checkout; the
 * remote boundary is enforced by the caller routing the request to the correct
 * server. Worktree creation happens *before* the first iteration is queued so a
 * Git failure aborts the launch without enqueuing anything.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { WorktreeExecutionRequest, WorktreeMetadata } from '@plusplusoneplusplus/coc-client';
import { GitWorktreeService } from '../worktree/worktree-service';
import { RalphSessionStore } from './ralph-session-store';

export interface CreateRalphLaunchWorktreeInput {
    /** Validated opt-in worktree request (undefined = not requested / opted out). */
    request: WorktreeExecutionRequest | undefined;
    /** Live feature-flag getter; treated as disabled when absent. */
    getGitWorktreeExecutionEnabled?: () => boolean;
    /** Repo-scoped data root (`~/.coc`). Worktree + journal live under here. */
    dataDir: string | undefined;
    /** Process store used to resolve the workspace's local checkout path. */
    store: ProcessStore | undefined;
    /** Target workspace id (this server's own checkout). */
    workspaceId: string | undefined;
    /** Ralph session id — used as the worktree run id + metadata record key. */
    sessionId: string;
    /** Goal text; seeds the worktree branch slug. */
    goalSpec: string;
}

export type CreateRalphLaunchWorktreeResult =
    | {
        ok: true;
        /** The created worktree, or undefined when worktree mode was not requested. */
        worktree?: WorktreeMetadata;
        /** Human-facing warning (e.g. dirty source checkout), if any. */
        warning?: string;
        /** Working directory the first iteration must run in (the worktree path). */
        workingDirectory?: string;
    }
    | { ok: false; error: string };

/**
 * Validate + create an isolated worktree for a Ralph launch, if requested.
 *
 * Returns `{ ok: false, error }` for any 400 condition (flag off, missing data
 * root/workspace, Git failure/invalid ref) so the caller can reject before
 * touching the journal or the queue. Returns `{ ok: true }` with no worktree
 * when the request is absent/opted out — existing behavior is preserved.
 *
 * Does NOT persist onto the session record; call {@link attachWorktreeToRalphSession}
 * after `initSession` so the record already carries the correct goal/iteration
 * fields.
 */
export async function createRalphLaunchWorktree(
    input: CreateRalphLaunchWorktreeInput,
): Promise<CreateRalphLaunchWorktreeResult> {
    if (!input.request?.enabled) {
        return { ok: true };
    }
    if (input.getGitWorktreeExecutionEnabled?.() !== true) {
        return { ok: false, error: 'Git worktree execution is not enabled' };
    }
    const dataDir = input.dataDir;
    if (!dataDir) {
        return { ok: false, error: 'Git worktree execution is not available on this server' };
    }
    const workspaceId = input.workspaceId;
    if (!workspaceId) {
        return { ok: false, error: 'workspaceId is required for worktree execution' };
    }
    if (!input.store) {
        return { ok: false, error: 'Workspace root is not available for worktree execution' };
    }

    let sourceRepoRoot: string | undefined;
    try {
        const workspaces = await input.store.getWorkspaces();
        sourceRepoRoot = workspaces.find(w => w.id === workspaceId)?.rootPath;
    } catch {
        sourceRepoRoot = undefined;
    }
    if (!sourceRepoRoot) {
        return { ok: false, error: 'Workspace root is not available for worktree execution' };
    }

    const service = new GitWorktreeService({ dataDir });
    try {
        const created = await service.createWorktree({
            workspaceId,
            sourceRepoRoot,
            runId: input.sessionId,
            baseRef: input.request.baseRef,
            slug: ralphBranchSlug(input.goalSpec),
            ralphSessionId: input.sessionId,
        });
        return {
            ok: true,
            worktree: created.metadata,
            warning: created.warning,
            workingDirectory: created.metadata.path,
        };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Attach worktree metadata onto the Ralph session record so resume/continue/
 * final-check and the dashboard chip can recover the worktree path. Best-effort:
 * recovery also works via the persisted process payload `workingDirectory`, so a
 * failure here is logged-and-swallowed by the caller, not fatal.
 */
export async function attachWorktreeToRalphSession(
    dataDir: string,
    workspaceId: string,
    sessionId: string,
    worktree: WorktreeMetadata,
): Promise<void> {
    const journal = new RalphSessionStore({ dataDir });
    await journal.updateSessionRecord(workspaceId, sessionId, (rec) => {
        const base = rec ?? {
            sessionId,
            workspaceId,
            originalGoal: '',
            maxIterations: 0,
            currentIteration: 0,
            phase: 'executing' as const,
            startedAt: worktree.createdAt,
            iterations: [],
        };
        return { ...base, worktree };
    });
}

/** Derive a branch slug seed from the goal spec's first meaningful line. */
function ralphBranchSlug(goalSpec: string): string {
    const firstLine = goalSpec
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line.length > 0) ?? '';
    return firstLine.replace(/^#+\s*/, '') || 'ralph';
}
