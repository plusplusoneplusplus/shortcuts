import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';

export interface JobTaskContext extends SentinelTodoOwner {
    jobId: string;
    runId: string;
    kind: 'run' | 'handback';
}

export function getJobTaskContext(task: Pick<QueuedTask, 'payload'>): JobTaskContext | undefined {
    const context = (task.payload.context as { sentinelScheduledJob?: JobTaskContext } | undefined)?.sentinelScheduledJob;
    return context && typeof context.workspaceId === 'string' && typeof context.processId === 'string'
        && typeof context.jobId === 'string' && typeof context.runId === 'string'
        && (context.kind === 'run' || context.kind === 'handback') ? context : undefined;
}

export function isScheduledJobProcess(proc: Pick<AIProcess, 'metadata'>): boolean {
    const job = proc.metadata?.sentinelScheduledJob as { jobId?: unknown; workspaceId?: unknown; processId?: unknown } | undefined;
    return !!job && typeof job.jobId === 'string' && typeof job.processId === 'string'
        && job.workspaceId === proc.metadata?.workspaceId
        && ['ask', 'autopilot'].includes(String(proc.metadata?.mode));
}

export const JOB_COMPACTION_INSTRUCTIONS = 'Preserve this job’s instructions, goals, unresolved asks, decisions, blockers and next actions. Retain explicit authorizations, their scope, cancellations and superseding instructions. Keep exact owner/workspace/conversation and job IDs, run numbers, snapshot paths, links and status. Distinguish proposed, authorized, attempted, completed, failed and cancelled work. Never infer permission or success. Each run must read its fresh snapshot. This job is not the Sentinel and has no authority to write its ledger. Remove stale details and duplication.';
