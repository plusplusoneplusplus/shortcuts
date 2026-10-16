import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isQueueProcessId, toQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';

/** Live queue lookup, keyed by the bare task id. */
export interface ProcessWorkspaceTaskSource {
    getTask?(taskId: string): { repoId?: string } | undefined;
}

/**
 * Resolve a conversation's owning workspace. Prefers the live queue task's
 * `repoId` (covers owners not yet persisted) and falls back to the persisted
 * process `metadata.workspaceId`, so completed owners keep resolving after a
 * restart drops them from the queue. Accepts bare or `queue_`-prefixed ids.
 * Returns undefined when neither source knows the process.
 */
export function createProcessWorkspaceResolver(
    tasks: ProcessWorkspaceTaskSource,
    store: Pick<ProcessStore, 'getProcess'>,
): (processId: string) => Promise<string | undefined> {
    return async (processId) => {
        try {
            const queued = isQueueProcessId(processId);
            const taskId = queued ? toTaskId(processId) : processId;
            const fromTask = tasks.getTask?.(taskId)?.repoId;
            if (fromTask) return fromTask;
            const proc = await store.getProcess(processId)
                ?? await store.getProcess(queued ? taskId : toQueueProcessId(taskId));
            const workspaceId = proc?.metadata?.workspaceId;
            return typeof workspaceId === 'string' && workspaceId ? workspaceId : undefined;
        } catch {
            return undefined;
        }
    };
}
