import { TaskDefs } from '../../../../tasks/task-types';
import { encodeSegment, repoHashBase } from '../layout/routePath';
import { ensureQueueProcessId } from '../utils/queue-process-id';
import type { QueueJob } from './hooks/useRepoQueueStats';

/** Matches the existing activity selection routes, including workflow queue ids. */
export function queueJobHash(routeId: string, job: QueueJob, tab = 'chats'): string {
    const workflow = job.type === TaskDefs.runWorkflow.kind && !job.payload?.workItemId && !job.workItemId;
    const id = workflow ? (job.processId || job.id) : (job.processId ?? ensureQueueProcessId(job.id));
    return `${repoHashBase(routeId)}/${workflow ? 'workflow' : tab}/${encodeSegment(id)}`;
}
