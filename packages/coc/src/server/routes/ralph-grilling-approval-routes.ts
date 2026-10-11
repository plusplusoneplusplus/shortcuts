import { randomUUID } from 'node:crypto';
import { isQueueProcessId, toTaskId, type ProcessStore } from '@plusplusoneplusplus/forge';
import { getRalphContext } from '../tasks/task-types';
import { processOperationAdmission } from '../processes/process-operation-admission';
import { RalphGrillingStore, isValidRalphGoal } from '../ralph/grilling-state';
import { parseBody, sendError, sendJSON } from '../core/api-handler';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { Route } from '../types';

/** Source-owned approval reservation for a launch on another workspace/server. */
export function registerRalphGrillingApprovalRoutes(routes: Route[], deps: { dataDir?: string; store: ProcessStore; getRalphEnabled?: () => boolean; bridge?: MultiRepoQueueRouter; onExecutionAdmitted?: (workspaceId: string, processId: string) => Promise<void> }): void {
    routes.push({
        method: 'POST', pattern: /^\/api\/processes\/([^/]+)\/ralph-start\/approval$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const body = await parseBody(req) as any;
            const process = await deps.store.getProcess(id);
            if (!process || !deps.dataDir) return sendError(res, 404, 'Grilling process not found');
            return processOperationAdmission.runExclusive(process.id, async () => {
                const proc = await deps.store.getProcess(process.id);
                const ctx = getRalphContext(proc);
                const workspaceId = proc?.metadata?.workspaceId;
                if (!proc || ctx?.phase !== 'grilling' || !ctx.sessionId || typeof workspaceId !== 'string') {
                    return sendError(res, 409, 'Process is not a native grilling interview');
                }
                const grilling = new RalphGrillingStore(deps.dataDir!);
                const state = await grilling.read(workspaceId, ctx.sessionId);
                if (!state || state.processId !== proc.id) return sendError(res, 409, 'Grilling owner mismatch');
                if (body.action === 'admitted') {
                    const execution = body.execution;
                    if (!state.start || state.start.taskId !== body.requestId || !state.start.targetKey
                        || !execution || typeof execution.workspaceId !== 'string'
                        || typeof execution.sessionId !== 'string' || typeof execution.processId !== 'string'
                        || typeof execution.remote !== 'boolean') return sendError(res, 409, 'Approval receipt mismatch');
                    if (!state.start.targetKey.endsWith(`:${execution.workspaceId}`)) return sendError(res, 409, 'Execution workspace does not match the approved target');
                    if (state.start.execution && JSON.stringify(state.start.execution) !== JSON.stringify(execution)) {
                        return sendError(res, 409, 'Approval already belongs to another execution');
                    }
                    if (!execution.remote) {
                        const child = await deps.store.getProcess(execution.processId);
                        const task = isQueueProcessId(execution.processId) ? deps.bridge?.getTask(toTaskId(execution.processId)) : undefined;
                        const owner = child?.metadata?.workspaceId ?? task?.payload.workspaceId;
                        if (owner !== execution.workspaceId || getRalphContext(child ?? task)?.sessionId !== execution.sessionId) {
                            return sendError(res, 409, 'Local execution admission identity cannot be verified');
                        }
                    }
                    state.start.status = 'admitted';
                    state.start.execution = execution;
                    await grilling.write(state);
                    await deps.store.updateProcess(proc.id, { metadata: { ...proc.metadata!, ralphLaunchedSession: {
                        ...execution, executionProcessId: execution.processId, launchedAt: new Date().toISOString(),
                    } } });
                    await deps.onExecutionAdmitted?.(workspaceId, proc.id);
                    return sendJSON(res, 200, { admitted: true });
                }
                if (typeof body.targetKey !== 'string' || !body.targetKey || body.targetKey.length > 500) {
                    return sendError(res, 400, 'Missing execution target identity');
                }
                if (!state.start?.execution && (proc.status !== 'completed' || proc.pendingAskUser)) {
                    return sendError(res, 409, 'Interview is no longer awaiting Start approval');
                }
                if (state.start) {
                    if (state.start.targetKey !== body.targetKey || state.start.goalSpec !== body.goalSpec) {
                        return sendError(res, 409, 'This interview already has a Start approval for another target or goal');
                    }
                    return sendJSON(res, 200, { requestId: state.start.taskId, execution: state.start.execution });
                }
                if (deps.getRalphEnabled?.() === false) return sendError(res, 403, 'Ralph is disabled (ralph.enabled)');
                if (proc.status !== 'completed' || proc.pendingAskUser || !state.goal
                    || body.goalRevision !== state.goal.revision || !await grilling.validatedGoal(state)) {
                    return sendError(res, 409, 'Goal spec is missing, invalid or stale; review the current synthesis before Start');
                }
                if (typeof body.goalSpec !== 'string' || !isValidRalphGoal(body.goalSpec)) return sendError(res, 400, 'Reviewed spec requires ## Goal');
                state.start = { taskId: randomUUID(), status: 'admitting', targetKey: body.targetKey, goalSpec: body.goalSpec.trim() };
                await grilling.write(state);
                return sendJSON(res, 200, { requestId: state.start.taskId });
            });
        },
    });
}
