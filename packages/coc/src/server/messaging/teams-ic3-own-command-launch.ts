import { isAbsolute } from 'node:path';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { prepareTaskForEnqueue } from '../routes/queue-enqueue';
import { enqueueViaBridge, validateAndParseTask, type QueueRouteContext } from '../routes/queue-shared';
import { processOperationAdmission } from '../processes/process-operation-admission';

export function createTeamsIc3OwnCommandLaunch(
    queue: QueueRouteContext & { store: NonNullable<QueueRouteContext['store']> },
) {
    return async (workspaceId: string, id: string, prompt: string, signal: AbortSignal, conversationId: string): Promise<void> =>
        processOperationAdmission.runExclusive(toQueueProcessId(conversationId), async () => {
            signal.throwIfAborted();
            if (queue.bridge.getTask(id)) return;
            const processId = toQueueProcessId(conversationId);
            const firstTask = queue.bridge.getTask(conversationId);
            const process = await queue.store.getProcess(processId);
            if ((firstTask && (firstTask.repoId !== workspaceId || firstTask.type !== 'chat'
                || firstTask.payload.mode !== 'ask' || firstTask.payload.processId))
                || (process && (process.type !== 'chat' || process.metadata?.workspaceId !== workspaceId
                    || process.metadata.queueTaskId !== conversationId))) {
                throw new Error('IC3 conversation ownership mismatch.');
            }
            if (firstTask?.payload.relayRequestId === id
                || process?.conversationTurns?.some(turn => turn.role === 'user' && turn.relayRequestId === id)) return;
            const followUp = !!(firstTask || process);
            const parsed = validateAndParseTask({
                type: 'chat', payload: { kind: 'chat', workspaceId, prompt, mode: 'ask', relayRequestId: id,
                    ...(followUp ? { processId } : {}) },
                config: followUp ? {} : { effortTier: 'medium' },
            });
            if (!parsed.valid || !parsed.input) throw new Error('Invalid IC3 chat command.');
            const task = parsed.input;
            await prepareTaskForEnqueue(task, queue);
            const workspace = (await queue.store.getWorkspaces()).find(item => item.id === workspaceId);
            signal.throwIfAborted();
            if (!workspace || workspace.virtual || !isAbsolute(workspace.rootPath)) {
                throw new Error('IC3 command workspace is unavailable.');
            }
            task.id = followUp ? id : conversationId;
            if (followUp) task.processId = processId;
            task.payload.workingDirectory = workspace.rootPath;
            await enqueueViaBridge(task, queue.bridge, queue.state, undefined, queue.store);
        });
}
