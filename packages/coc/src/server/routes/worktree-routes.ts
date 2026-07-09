/**
 * Git worktree management routes (AC-06 cleanup UI backend).
 *
 * Workspace-scoped, following the `/api/workspaces/:id/...` pattern:
 *
 *   GET  /api/workspaces/:workspaceId/worktrees
 *        — list the CoC-created worktree records for a workspace (newest first).
 *   POST /api/workspaces/:workspaceId/worktrees/:id/cleanup
 *        — remove a CoC-created worktree checkout via `git worktree remove`
 *          (never `--force`) and mark the record `cleaned`.
 *
 * Cleanup only ever touches CoC-created worktrees recorded in the metadata
 * store; it never deletes the generated branch, is refused while a linked
 * task/session is still running, and surfaces the raw Git error (leaving the
 * record intact) when Git refuses removal — e.g. a dirty worktree. There is no
 * force/discard path.
 */

import { sendJSON, sendError } from '../core/api-handler';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { GitWorktreeService } from '../worktree/worktree-service';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';

export interface WorktreeRouteContext {
    /** Process store — resolves the workspace's local checkout + linked run status. */
    store?: ProcessStore;
    /** Repo-scoped data root (`~/.coc` or override). Home of the worktree records. */
    dataDir?: string;
    /** Whether the opt-in Git worktree execution feature flag is enabled on this server. */
    getGitWorktreeExecutionEnabled?: () => boolean;
}

/** Process statuses that count as "still running" for the cleanup guard. */
const RUNNING_STATUSES = new Set(['queued', 'running', 'cancelling']);

/**
 * Decide whether a worktree's linked task/session is still running, so cleanup
 * can be refused (AC-06). Covers both a one-shot Work Item process and a Ralph
 * session:
 *   - a directly-linked process in a non-terminal state, or
 *   - a Ralph session that has not completed (or still has an in-flight
 *     iteration).
 * Best-effort: any lookup failure is treated as "not running" so a broken link
 * never permanently blocks cleanup.
 */
async function isWorktreeRunning(
    record: WorktreeMetadata,
    store: ProcessStore | undefined,
    dataDir: string | undefined,
): Promise<boolean> {
    if (store && record.processId) {
        try {
            const proc = await store.getProcess(record.processId, record.workspaceId);
            if (proc && RUNNING_STATUSES.has(proc.status)) return true;
        } catch {
            // Ignore — a missing/unreadable process does not block cleanup.
        }
    }
    if (dataDir && record.ralphSessionId) {
        try {
            const journal = new RalphSessionStore({ dataDir });
            const session = await journal.readSessionRecord(record.workspaceId, record.ralphSessionId);
            if (session) {
                // A session that has not reached its terminal phase is still in
                // flight (executing/grilling between iterations).
                if (session.phase !== 'complete' && !session.terminalReason) return true;
                // Belt-and-suspenders: a straggler iteration still marked running.
                if (session.iterations?.some(it => it.status === 'running')) return true;
            }
        } catch {
            // Ignore — a missing/unreadable journal does not block cleanup.
        }
    }
    return false;
}

/** Resolve a workspace's local source-checkout root, or `undefined`. */
async function resolveSourceRepoRoot(
    store: ProcessStore | undefined,
    workspaceId: string,
): Promise<string | undefined> {
    if (!store) return undefined;
    try {
        const workspaces = await store.getWorkspaces();
        return workspaces.find(w => w.id === workspaceId)?.rootPath;
    } catch {
        return undefined;
    }
}

export function registerWorktreeRoutes(routes: Route[], ctx: WorktreeRouteContext): void {
    const { store, dataDir, getGitWorktreeExecutionEnabled } = ctx;
    const isEnabled = () => getGitWorktreeExecutionEnabled?.() === true;

    // ------------------------------------------------------------------
    // GET /api/workspaces/:workspaceId/worktrees
    //
    // Lists the CoC-created worktree records for a single workspace, newest
    // first. Strictly workspace-scoped (the store keys records per workspace),
    // so it never mixes records across workspaces or remote targets. When the
    // feature flag is off, returns an empty list — the dashboard hides all
    // worktree UI in that state.
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/worktrees$/,
        handler: async (_req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!workspaceId) return sendError(res, 400, 'Missing workspace ID');

            if (!isEnabled() || !dataDir) {
                return sendJSON(res, 200, { worktrees: [] });
            }

            const service = new GitWorktreeService({ dataDir });
            const worktrees = await service.listWorktrees(workspaceId);
            sendJSON(res, 200, { worktrees });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:workspaceId/worktrees/:id/cleanup
    //
    // Removes a CoC-created worktree checkout (git worktree remove, never
    // --force) and marks the record cleaned. Refused while the linked
    // task/session is running (409). On Git refusal (e.g. dirty worktree) the
    // raw error is surfaced and the record is left intact — there is no force
    // or discard path, and the branch is never deleted.
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/worktrees\/([^/]+)\/cleanup$/,
        handler: async (_req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            const id = match?.[2] ? decodeURIComponent(match[2]) : undefined;
            if (!workspaceId) return sendError(res, 400, 'Missing workspace ID');
            if (!id) return sendError(res, 400, 'Missing worktree ID');

            if (!isEnabled()) {
                return sendError(res, 400, 'Git worktree execution is not enabled');
            }
            if (!dataDir) {
                return sendError(res, 400, 'Git worktree execution is not available on this server');
            }

            const service = new GitWorktreeService({ dataDir });
            const record = await service.getWorktree(workspaceId, id);
            if (!record) {
                return sendError(res, 404, `Worktree "${id}" not found for workspace "${workspaceId}"`);
            }

            // Idempotent: an already-cleaned record needs no Git work.
            if (record.status === 'cleaned') {
                return sendJSON(res, 200, { worktree: record, alreadyCleaned: true });
            }

            // Refuse while the linked task/session is still running.
            if (await isWorktreeRunning(record, store, dataDir)) {
                return sendError(
                    res,
                    409,
                    'Cannot clean up a worktree while its linked task or session is still running',
                );
            }

            const sourceRepoRoot = await resolveSourceRepoRoot(store, workspaceId);
            if (!sourceRepoRoot) {
                return sendError(res, 400, 'Workspace root is not available for worktree cleanup');
            }

            try {
                const result = await service.removeWorktree(workspaceId, id, sourceRepoRoot);
                sendJSON(res, 200, {
                    worktree: result.metadata,
                    alreadyCleaned: result.alreadyCleaned,
                });
            } catch (err) {
                // Git refused removal (e.g. the worktree has uncommitted changes).
                // Surface the raw error and leave the record intact — no --force.
                sendError(res, 409, err instanceof Error ? err.message : String(err));
            }
        },
    });
}
