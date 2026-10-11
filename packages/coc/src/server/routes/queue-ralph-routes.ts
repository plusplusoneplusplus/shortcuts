/**
 * POST /api/processes/:id/ralph-start — validate a completed grilling-phase
 * process, initialize the per-session journal, and enqueue the first Ralph
 * execution task.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ProcessStore, CreateTaskInput } from '@plusplusoneplusplus/forge';
import { toQueueProcessId, isQueueProcessId, toTaskId, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { getRalphContext } from '../tasks/task-types';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { buildRalphIterationTask } from '../ralph/enqueue-iteration';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';
import { parseRalphAiSelection } from './ralph-route-utils';
import { parseWorktreeExecutionRequest } from '../worktree/worktree-request';
import { createRalphLaunchWorktree, attachWorktreeToRalphSession } from '../ralph/ralph-worktree-launch';
import { processOperationAdmission } from '../processes/process-operation-admission';
import { RalphGrillingStore, isValidRalphGoal } from '../ralph/grilling-state';
import { randomUUID } from 'node:crypto';
import { captureRalphBaselineSha } from '../ralph/capture-baseline-sha';

export interface QueueRalphRouteContext {
    getRalphEnabled?: () => boolean;
    bridge: MultiRepoQueueRouter;
    store: ProcessStore;
    /** Repo-scoped data root (`~/.coc` or override). Used for the per-session journal. */
    dataDir?: string;
    /** Whether the opt-in Git worktree execution feature flag is enabled on this server. */
    getGitWorktreeExecutionEnabled?: () => boolean;
}

export function registerRalphRoutes(routes: Route[], ctx: QueueRalphRouteContext): void {
    const { bridge, store, dataDir, getGitWorktreeExecutionEnabled } = ctx;

    // ------------------------------------------------------------------
    // POST /api/processes/:id/ralph-start
    //
    // Validates that the referenced process is a completed grilling-phase
    // Ralph session, then enqueues the first Ralph execution task.
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/ralph-start$/,
        handler: async (req, res, match) => {
            const rawId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!rawId) return sendError(res, 400, 'Missing process ID');

            return processOperationAdmission.runExclusive(isQueueProcessId(rawId) ? rawId : toQueueProcessId(rawId), async () => {
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

                // Resolve process (handle queue_ prefix vs bare UUID)
                let proc = await store.getProcess(rawId, workspaceId);
                if (!proc && isQueueProcessId(rawId)) {
                    proc = await store.getProcess(toTaskId(rawId), workspaceId);
                }
                if (!proc) {
                    return sendError(res, 404, 'Process not found');
                }

                // Validate: must be completed
                if (proc.status !== 'completed') {
                    return sendError(res, 400, 'Process is not completed');
                }

                // Validate: must be grilling phase
                const procPayload = (proc as any).payload as Record<string, any> | undefined;
                const ralphCtx = getRalphContext(proc);
                if (!ralphCtx || ralphCtx.phase !== 'grilling') {
                    return sendError(res, 400, 'Process is not in grilling phase');
                }
                if (!ralphCtx.sessionId) {
                    return sendError(res, 400, 'Process is missing Ralph session ID');
                }

                const owner = proc.metadata?.workspaceId ?? procPayload?.workspaceId;
                if (workspaceId && owner && workspaceId !== owner) return sendError(res, 409, 'Ralph grilling workspace owner mismatch');
                const wsId = typeof owner === 'string' ? owner : workspaceId;
                const grilling = dataDir && wsId ? new RalphGrillingStore(dataDir) : undefined;
                const state = grilling && wsId ? await grilling.read(wsId, ralphCtx.sessionId) : undefined;
                if (state) {
                    if (ctx.getRalphEnabled?.() === false && !state.start) return sendError(res, 403, 'Ralph is disabled (ralph.enabled)');
                    if (state.processId !== proc.id) return sendError(res, 409, 'Ralph grilling conversation owner mismatch');
                    if (state.start && state.start.status !== 'rejected') {
                        if (state.start.targetKey) {
                            if (state.start.execution) return sendJSON(res, 200, {
                                processId: state.start.execution.processId, sessionId: state.start.execution.sessionId,
                                workspaceId: state.start.execution.workspaceId,
                            });
                            return sendError(res, 409, 'Start approval belongs to another target; recover admission on that approved target');
                        }
                        const accepted = state.start.status === 'admitted' || !!bridge.getTask?.(state.start.taskId);
                        if (!accepted) return sendError(res, 409, 'Start admission is uncertain; inspect the session before retrying');
                        if (state.start.status !== 'admitted') { state.start.status = 'admitted'; await grilling!.write(state); }
                        return sendJSON(res, 200, { processId: toQueueProcessId(state.start.taskId), sessionId: ralphCtx.sessionId });
                    }
                    if (!state.goal || body.goalRevision !== state.goal.revision || !await grilling!.validatedGoal(state)) {
                        return sendError(res, 409, 'Goal spec is missing, invalid or stale; synthesize and review the current goal before Start');
                    }
                    if (!isValidRalphGoal(goalSpec)) return sendError(res, 400, 'Reviewed spec requires a non-empty ## Goal section');
                    if (proc.pendingAskUser) return sendError(res, 409, 'Answer the pending interview questions before Start');
                }

                const workingDirectory: string | undefined =
                    procPayload?.workingDirectory
                    ?? procPayload?.folderPath
                    ?? proc.workingDirectory;
                const folderPath: string | undefined = procPayload?.folderPath;
                // Resolution order: explicit context > per-repo preference > hardcoded default.
                let prefMax: number | undefined;
                if (dataDir && wsId) {
                    try {
                        prefMax = readRepoPreferences(dataDir, wsId).maxRalphIterations;
                    } catch {
                        // Preferences are optional
                    }
                }
                const maxIterations = ralphCtx.maxIterations ?? prefMax ?? RALPH_DEFAULT_MAX_ITERATIONS;

                // Opt-in isolated Git worktree. Created BEFORE the journal is seeded
                // and BEFORE the first iteration is queued, so a Git failure aborts
                // the start cleanly. The first iteration then runs in the worktree.
                const worktreeResult = await createRalphLaunchWorktree({
                    request: worktree.value,
                    getGitWorktreeExecutionEnabled,
                    dataDir,
                    store,
                    workspaceId: wsId,
                    sessionId: ralphCtx.sessionId,
                    goalSpec,
                });
                if (!worktreeResult.ok) {
                    return sendError(res, 400, worktreeResult.error);
                }
                const worktreeMetadata = worktreeResult.worktree;
                const executionWorkingDirectory = worktreeResult.workingDirectory ?? workingDirectory;
                const executionFolderPath = worktreeMetadata ? worktreeMetadata.path : folderPath;

                // Initialise the per-session journal (idempotent). Best-effort:
                // on failure we still enqueue — the bridge will create the file
                // lazily on the first iteration.
                if (dataDir && wsId && ralphCtx.sessionId) {
                    try {
                        // Non-worktree sessions record the checkout's HEAD as the
                        // PR-submit baseline; worktree sessions carry worktree.baseSha.
                        const baselineSha = worktreeMetadata
                            ? undefined
                            : await captureRalphBaselineSha({
                                workingDirectory,
                                store,
                                workspaceId: wsId,
                            });
                        const journal = new RalphSessionStore({ dataDir });
                        await journal.initSession(wsId, ralphCtx.sessionId, {
                            originalGoal: goalSpec,
                            maxIterations,
                            baselineSha,
                        });
                        if (state) await journal.updateSessionRecord(wsId, ralphCtx.sessionId, record => {
                            if (!record) throw new Error('Ralph grilling journal is missing');
                            return { ...record, ...(record.baselineSha || !baselineSha ? {} : { baselineSha }) };
                        });
                        if (worktreeMetadata) {
                            await attachWorktreeToRalphSession(dataDir, wsId, ralphCtx.sessionId, worktreeMetadata);
                        }
                    } catch (err) {
                        getLogger().debug(
                            LogCategory.AI,
                            `[Ralph] initSession failed for ${ralphCtx.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                        );
                    }
                }

                // Durable reservation precedes admission. An uncertain crash never relaunches.
                const task: CreateTaskInput = buildRalphIterationTask({
                    workspaceId: wsId, workingDirectory: executionWorkingDirectory,
                    folderPath: executionFolderPath, sessionId: ralphCtx.sessionId,
                    originalGoal: goalSpec, iteration: 1, maxIterations, dataDir,
                    provider, model, reasoningEffort, effortTier, autoProviderRouting,
                });
                task.id = randomUUID();
                if (state) {
                    state.start = { taskId: task.id, goalSpec, status: 'admitting' };
                    await grilling!.write(state);
                    await new RalphSessionStore({ dataDir: dataDir! }).updateSessionRecord(wsId!, ralphCtx.sessionId, record => {
                        if (!record || record.phase !== 'grilling') throw new Error('Ralph session is not awaiting Start approval');
                        return { ...record, phase: 'executing', originalGoal: goalSpec, maxIterations };
                    });
                }
                let taskId: string;
                try {
                    taskId = await bridge.enqueue(task);
                } catch (error) {
                    if (!bridge.getTask?.(task.id)) {
                        if (state) {
                            state.start!.status = 'rejected'; await grilling!.write(state);
                            await new RalphSessionStore({ dataDir: dataDir! }).updateSessionRecord(wsId!, ralphCtx.sessionId,
                                record => ({ ...record!, phase: 'grilling' }));
                        }
                        throw error;
                    }
                    taskId = task.id;
                }
                if (state) { state.start!.taskId = taskId; state.start!.status = 'admitted'; await grilling!.write(state); }
                sendJSON(res, 200, {
                    processId: toQueueProcessId(taskId), sessionId: ralphCtx.sessionId,
                    ...(worktreeMetadata ? { worktree: worktreeMetadata } : {}),
                    ...(worktreeResult.warning ? { worktreeWarning: worktreeResult.warning } : {}),
                });
            });
        },
    });
}
