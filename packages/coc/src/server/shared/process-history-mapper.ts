/**
 * Maps AIProcess records from the process store into the HistorySummary shape
 * consumed by the SPA dashboard's history views.
 *
 * NOTE: chatMeta enrichment was removed — the activity tab now uses
 * GET /api/workspaces/:id/history instead.
 */

import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';

export interface HistorySummary {
    id: string;
    processId: string;
    status: string;
    type: string;
    displayName: string;
    completedAt: number | null;
    error?: string;
    repoId: string;
    prompt?: string;
    promptPreview?: string;
    payload?: Record<string, unknown>;
    /** User-set custom title (rename UI). Orthogonal to the AI-generated title. */
    customTitle?: string;
    /** Denormalized cleaned snapshot of the most recent conversation turn. */
    lastMessagePreview?: string;
    /** AI-generated title (separate from customTitle). */
    title?: string;
    /** AI provider that handled this process ('copilot' | 'codex'). */
    provider?: 'copilot' | 'codex';
}

export function processToHistorySummary(proc: AIProcess): HistorySummary {
    const completedAt = proc.endTime
        ? new Date(proc.endTime).getTime()
        : null;

    const displayName = proc.customTitle
        || proc.title
        || proc.promptPreview
        || proc.id;

    return {
        id: isQueueProcessId(proc.id) ? toTaskId(proc.id) : proc.id,
        processId: proc.id,
        status: proc.status,
        type: proc.type,
        displayName,
        completedAt,
        error: proc.error,
        repoId: proc.metadata?.workspaceId ?? '',
        prompt: proc.fullPrompt,
        promptPreview: proc.promptPreview,
        payload: {
            mode: proc.metadata?.mode as string | undefined,
            pipelineName: proc.metadata?.pipelineName as string | undefined,
            workItemId: proc.metadata?.workItemId as string | undefined,
        },
        customTitle: proc.customTitle,
        lastMessagePreview: proc.lastMessagePreview,
        title: proc.title,
        provider: (proc.metadata?.provider === 'codex' ? 'codex' : 'copilot') as 'copilot' | 'codex',
    };
}

/**
 * Map AIProcessStatus to QueueStatus.
 * 'cancelling' has no QueueStatus equivalent — treat it as 'cancelled'.
 */
function mapProcessStatus(status: string): string {
    return status === 'cancelling' ? 'cancelled' : status;
}

/**
 * Reconstruct a read-only task detail from a stored AIProcess for the
 * GET /api/queue/:id endpoint.  Unlike processToQueuedTask, this preserves
 * the original status and timestamps instead of hardcoding 'queued'.
 */
export function processToTaskDetail(proc: AIProcess): Partial<QueuedTask> {
    return {
        id: isQueueProcessId(proc.id) ? toTaskId(proc.id) : proc.id,
        type: proc.type === 'clarification' ? 'chat' : proc.type,
        status: mapProcessStatus(proc.status) as any,
        payload: {
            prompt: proc.fullPrompt,
            processId: proc.id,
            workingDirectory: proc.workingDirectory,
            workspaceId: proc.metadata?.workspaceId,
            mode: proc.metadata?.mode,
            pipelineName: proc.metadata?.pipelineName,
            workItemId: proc.metadata?.workItemId,
        } as any,
        displayName: proc.customTitle || proc.title || proc.promptPreview || proc.id,
        processId: proc.id,
        repoId: proc.metadata?.workspaceId,
        createdAt: proc.startTime ? new Date(proc.startTime).getTime() : Date.now(),
        startedAt: proc.startTime ? new Date(proc.startTime).getTime() : undefined,
        completedAt: proc.endTime ? new Date(proc.endTime).getTime() : undefined,
        error: proc.error,
        config: { model: proc.metadata?.model as string | undefined } as any,
        customTitle: proc.customTitle,
        lastMessagePreview: proc.lastMessagePreview,
        title: proc.title,
    } as any;
}

/**
 * Reconstruct a minimal QueuedTask from a stored AIProcess so it can be
 * re-enqueued for follow-up messages after a server restart.
 */
export function processToQueuedTask(proc: AIProcess): Partial<QueuedTask> {
    return {
        id: isQueueProcessId(proc.id) ? toTaskId(proc.id) : proc.id,
        type: proc.type === 'clarification' ? 'chat' : proc.type,
        status: 'queued' as any,
        payload: {
            prompt: proc.fullPrompt,
            processId: proc.id,
            workingDirectory: proc.workingDirectory,
            workspaceId: proc.metadata?.workspaceId,
            mode: proc.metadata?.mode,
        } as any,
        displayName: proc.customTitle || proc.title || proc.promptPreview || proc.id,
        processId: proc.id,
        repoId: proc.metadata?.workspaceId,
        createdAt: Date.now(),
        customTitle: proc.customTitle,
        lastMessagePreview: proc.lastMessagePreview,
        title: proc.title,
    } as any;
}
