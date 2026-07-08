/**
 * Ralph direct-launch route.
 *
 * POST /api/ralph-launch — launch a Ralph execution loop directly from a
 * goal spec (e.g. read from a goal.md file), skipping the grilling/synthesis
 * phase entirely. Mints a new session, initialises the journal, and enqueues
 * the first Ralph execution task.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { toQueueProcessId, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { buildRalphIterationTask } from '../ralph/enqueue-iteration';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';
import { parseRalphAiSelection } from './ralph-route-utils';
import { parseWorktreeExecutionRequest } from '../worktree/worktree-request';

export interface RalphLaunchRouteContext {
    bridge: MultiRepoQueueRouter;
    /** Repo-scoped data root (`~/.coc` or override). Used for the per-session journal. */
    dataDir?: string;
}

function mintSessionId(): string {
    return `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function registerRalphLaunchRoutes(routes: Route[], ctx: RalphLaunchRouteContext): void {
    const { bridge, dataDir } = ctx;

    routes.push({
        method: 'POST',
        pattern: /^\/api\/ralph-launch$/,
        handler: async (req, res) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const goalSpec = typeof body.goalSpec === 'string' ? body.goalSpec.trim() : '';
            if (!goalSpec) {
                return sendError(res, 400, 'Missing or empty field: goalSpec');
            }

            const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId
                ? body.workspaceId
                : undefined;
            const folderPath = typeof body.folderPath === 'string' && body.folderPath
                ? body.folderPath
                : undefined;
            const workingDirectory = typeof body.workingDirectory === 'string' && body.workingDirectory
                ? body.workingDirectory
                : undefined;
            const aiSelection = parseRalphAiSelection(body);
            if ('error' in aiSelection) {
                return sendError(res, 400, aiSelection.error);
            }
            const { provider, model, reasoningEffort, effortTier, autoProviderRouting } = aiSelection.value;

            // Opt-in Git worktree request. Shape is validated here; the worktree
            // itself is created by a later wiring step. Omitting it preserves
            // existing behavior.
            const worktree = parseWorktreeExecutionRequest(body.worktree);
            if (!worktree.ok) {
                return sendError(res, 400, worktree.error);
            }

            // Resolve max iterations: per-repo preference > hardcoded default.
            let prefMax: number | undefined;
            if (dataDir && workspaceId) {
                try {
                    prefMax = readRepoPreferences(dataDir, workspaceId).maxRalphIterations;
                } catch {
                    // Preferences are optional
                }
            }
            const maxIterations = prefMax ?? RALPH_DEFAULT_MAX_ITERATIONS;

            const sessionId = mintSessionId();

            // Initialise the per-session journal (idempotent).
            if (dataDir && workspaceId) {
                try {
                    const journal = new RalphSessionStore({ dataDir });
                    await journal.initSession(workspaceId, sessionId, {
                        originalGoal: goalSpec,
                        maxIterations,
                    });
                } catch (err) {
                    getLogger().debug(
                        LogCategory.AI,
                        `[Ralph launch] initSession failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            }

            // Enqueue the first Ralph execution task
            const task = buildRalphIterationTask({
                workspaceId,
                workingDirectory,
                folderPath,
                sessionId,
                originalGoal: goalSpec,
                iteration: 1,
                maxIterations,
                dataDir,
                provider,
                model,
                reasoningEffort,
                effortTier,
                autoProviderRouting,
            });

            const taskId = await bridge.enqueue(task);

            sendJSON(res, 200, { processId: toQueueProcessId(taskId), sessionId });
        },
    });
}
