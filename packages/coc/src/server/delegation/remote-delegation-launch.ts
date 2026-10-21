import { z } from 'zod';
import { toQueueProcessId, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { RemoteDelegationDispatch, RemoteDelegationFindChild } from './remote-delegation-admission';
import { launchRalphSession } from '../ralph/ralph-launch-service';
import { getRalphContext, type ChatProvider } from '../tasks/task-types';
import { prepareTaskForEnqueue } from '../routes/queue-enqueue';
import { enqueueViaBridge, validateAndParseTask, type QueueRouteContext } from '../routes/queue-shared';

const text = z.string().min(1).refine(value => !!value.trim());
const aiFields = {
    provider: z.enum(['copilot', 'claude', 'codex', 'opencode']).optional(),
    autoProviderRouting: z.boolean().optional(),
    config: z.object({
        model: text.max(512).optional(),
        reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
        effortTier: z.enum(['very-low', 'low', 'medium', 'high']).optional(),
    }).strict().optional(),
    title: text.max(80).optional(),
};
export const remoteChatLaunchBody = z.object({
    content: text, mode: z.enum(['ask', 'autopilot']).optional(),
    priority: z.enum(['high', 'normal', 'low']).optional(), ...aiFields,
}).strict();
export const remoteRalphLaunchBody = z.object({
    goalSpec: text, entryPoint: z.enum(['grill', 'execute']).optional(), ...aiFields,
}).strict();

/** Only a pre-enqueue domain refusal is definitive. Queue/storage errors remain uncertain. */
class RemoteLaunchRejectedError extends Error {}

/** Destination-owned paths, task/session IDs and domain policy; no caller-supplied context. */
export function createRemoteDelegationLaunch(options: {
    queue: QueueRouteContext & { store: NonNullable<QueueRouteContext['store']>; dataDir: string };
    getRalphEnabled: () => boolean;
    getRetainedTask?: (workspaceId: string, taskId: string) => import('@plusplusoneplusplus/forge').QueuedTask | undefined;
}): { dispatch: RemoteDelegationDispatch; findChild: RemoteDelegationFindChild } {
    const { queue } = options;
    const workspace = async (workspaceId: string) => {
        const owner = (await queue.store.getWorkspaces()).find(row => row.id === workspaceId);
        if (!owner?.rootPath) throw new RemoteLaunchRejectedError('Remote launch requires a registered workspace');
        return owner;
    };
    return {
        dispatch: async ({ binding, intent, executionId }) => {
            if (binding.kind !== 'launch' && binding.kind !== 'ralph') throw new Error('Unsupported launch kind');
            let enqueueAttempted = false;
            try {
                const owner = await workspace(binding.destination.workspaceId);
                const enqueue = async (input: CreateTaskInput): Promise<string> => {
                    // Match normal queue preparation, including destination tier/Auto policy.
                    await prepareTaskForEnqueue(input, queue);
                    const provider = input.payload.provider as ChatProvider | undefined;
                    if (provider) await queue.validateProvider?.(provider);
                    const current = await workspace(owner.id);
                    if (current.rootPath !== owner.rootPath) throw new RemoteLaunchRejectedError('Remote workspace changed');
                    if (binding.kind === 'ralph' && !options.getRalphEnabled()) throw new RemoteLaunchRejectedError('Ralph is disabled');
                    input.id = executionId;
                    input.payload.workspaceId = owner.id;
                    input.payload.workingDirectory = current.rootPath;
                    enqueueAttempted = true;
                    return enqueueViaBridge(input, queue.bridge, queue.state, undefined, queue.store);
                };
                if (binding.kind === 'launch') {
                    const body = remoteChatLaunchBody.parse(intent.body);
                    const task = validateAndParseTask({ type: 'chat', priority: body.priority,
                        displayName: body.title, config: body.config, payload: {
                            kind: 'chat', workspaceId: owner.id, prompt: body.content, mode: body.mode ?? 'ask',
                            relayRequestId: executionId,
                            ...(body.provider ? { provider: body.provider } : {}),
                            ...(body.title ? { customTitle: body.title } : {}),
                            ...(body.autoProviderRouting ? { context: { autoProviderRouting: { requested: true } } } : {}),
                        } });
                    if (!task.valid) return { state: 'rejected' };
                    await enqueue(task.input!);
                    return { state: 'accepted', child: { processId: toQueueProcessId(executionId) } };
                }
                const body = remoteRalphLaunchBody.parse(intent.body);
                if (!options.getRalphEnabled()) return { state: 'rejected' };
                // Reuse native interview/approved execution admission. The private destination
                // ID owns the session and first task; an origin UUID never becomes a task ID.
                const bridge = Object.create(queue.bridge) as typeof queue.bridge;
                Object.defineProperty(bridge, 'enqueue', { value: enqueue });
                const result = await launchRalphSession({
                    requestId: executionId, workspaceId: owner.id, goalSpec: body.goalSpec,
                    entryPoint: body.entryPoint, title: body.title, aiSelection: body,
                    workingDirectory: owner.rootPath,
                }, { bridge, store: queue.store, dataDir: queue.dataDir, getRalphEnabled: options.getRalphEnabled });
                if (!result.ok) {
                    if (enqueueAttempted) throw new Error('Uncertain Ralph queue admission');
                    return { state: 'rejected' };
                }
                return { state: 'accepted', child: { processId: result.processId, sessionId: result.sessionId } };
            } catch (error) {
                if (!enqueueAttempted && error instanceof RemoteLaunchRejectedError) return { state: 'rejected' };
                throw error;
            }
        },
        findChild: async row => {
            if (row.kind !== 'launch' && row.kind !== 'ralph') return undefined;
            const processId = toQueueProcessId(row.executionId);
            const sessionId = row.kind === 'ralph' ? `ralph-approved-${row.executionId}` : undefined;
            const task = queue.bridge.getTask(row.executionId) ?? options.getRetainedTask?.(row.destination.workspaceId, row.executionId);
            const process = await queue.store.getProcess(processId);
            const followUp = task?.processId ?? task?.payload.processId;
            // Any conflicting evidence fails closed, even when another record matches.
            if (task && (task.id !== row.executionId || task.type !== 'chat'
                || (task.processId && task.processId !== processId)
                || (task.payload.processId && task.payload.processId !== processId)
                || (followUp && !process) || task.payload.workspaceId !== row.destination.workspaceId
                || (sessionId ? (getRalphContext(task) ?? (followUp ? getRalphContext(process) : null))?.sessionId !== sessionId
                    : !!getRalphContext(task) || !['ask', 'autopilot'].includes(String(task.payload.mode))))) {
                throw new Error('Conflicting remote launch task');
            }
            if (process && (process.id !== processId || process.type !== 'chat'
                || process.metadata?.workspaceId !== row.destination.workspaceId
                || (sessionId ? getRalphContext(process)?.sessionId !== sessionId
                    : !!getRalphContext(process) || !['ask', 'autopilot'].includes(String(process.metadata?.mode))))) {
                throw new Error('Conflicting remote launch process');
            }
            // A journal alone proves preparation, not queue acceptance. Missing evidence
            // remains uncertain; reconciliation never calls launchRalphSession or enqueue.
            return task || process ? { processId, ...(sessionId ? { sessionId } : {}) } : undefined;
        },
    };
}
