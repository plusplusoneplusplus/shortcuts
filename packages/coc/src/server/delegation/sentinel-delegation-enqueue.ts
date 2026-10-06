import { randomUUID } from 'node:crypto';
import { toQueueProcessId, type CreateTaskInput, type ProcessStore } from '@plusplusoneplusplus/forge';
import { normalizeChatMode } from '../tasks/task-types';
import { DelegatedJobStore } from './delegated-job-store';

/** Register local Sentinel handoffs before the queue can execute their first turn. */
export function createSentinelDelegationEnqueue(deps: {
    store: ProcessStore;
    jobs: DelegatedJobStore;
    /** Admission can succeed even when a later taskAdded observer throws. */
    hasTask: (taskId: string) => boolean;
}) {
    return async (input: CreateTaskInput, enqueue: (input: CreateTaskInput) => Promise<string>): Promise<string> => {
        const context = input.payload.context as Record<string, unknown> | undefined;
        const parentId = context?.spawnedFromProcessId;
        if (input.type !== 'chat' || typeof parentId !== 'string') return enqueue(input);
        const parent = await deps.store.getProcess(parentId);
        if (normalizeChatMode(parent?.metadata?.mode) !== 'sentinel') return enqueue(input);

        const parentWorkspaceId = parent?.metadata?.workspaceId;
        const childWorkspaceId = input.payload.workspaceId;
        if (typeof parentWorkspaceId !== 'string' || !parentWorkspaceId
            || typeof childWorkspaceId !== 'string' || !childWorkspaceId) {
            throw new Error('Sentinel delegation requires parent and child workspace identities');
        }
        const ralph = context?.ralph as { sessionId?: string } | undefined;
        // Only launch admission is wrapped; continuation/final-check tasks are not registered.
        const taskId = input.id ?? randomUUID();
        input.id = taskId;
        const processId = toQueueProcessId(taskId);
        const job = deps.jobs.register({
            id: processId,
            parent: { workspaceId: parentWorkspaceId, processId: parentId },
            child: {
                workspaceId: childWorkspaceId, processId,
                ...(ralph?.sessionId ? { sessionId: ralph.sessionId } : {}),
            },
            title: (input.displayName?.trim() || 'Delegated job').slice(0, 80),
        });
        try {
            return await enqueue(input);
        } catch (error) {
            if (!deps.hasTask(taskId)) {
                // Rejected launches must not become pending result reviews after recovery.
                deps.jobs.recordResult(parentWorkspaceId, job.id, {
                    terminalEventId: `admission-rejected:${taskId}`,
                    outcome: 'failed', summary: 'The delegated job was not admitted to the queue.', links: [],
                }, {
                    state: 'failed', reason: 'Queue admission rejected; the originating tool reports the error.',
                });
            }
            throw error;
        }
    };
}
