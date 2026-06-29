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
    /** AI provider that handled this process. */
    provider?: 'copilot' | 'codex' | 'claude' | 'opencode';
}

interface DreamProcessLinks {
    analyzerProcessId?: string;
    criticProcessId?: string;
}

function readDreamMetadata(proc: AIProcess): Record<string, unknown> | undefined {
    return proc.metadata?.dream && typeof proc.metadata.dream === 'object' && !Array.isArray(proc.metadata.dream)
        ? proc.metadata.dream as Record<string, unknown>
        : undefined;
}

function parseDreamProcessLinks(proc: AIProcess): DreamProcessLinks {
    const dream = readDreamMetadata(proc);
    const links: DreamProcessLinks = {};
    if (typeof dream?.analyzerProcessId === 'string') {
        links.analyzerProcessId = dream.analyzerProcessId;
    }
    if (typeof dream?.criticProcessId === 'string') {
        links.criticProcessId = dream.criticProcessId;
    }

    if (typeof proc.result !== 'string' || proc.result.trim().length === 0) {
        return links;
    }

    try {
        const parsed = JSON.parse(proc.result) as unknown;
        const processes = parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>).processes
            : undefined;
        if (processes && typeof processes === 'object' && !Array.isArray(processes)) {
            const record = processes as Record<string, unknown>;
            if (!links.analyzerProcessId && typeof record.analyzerProcessId === 'string') {
                links.analyzerProcessId = record.analyzerProcessId;
            }
            if (!links.criticProcessId && typeof record.criticProcessId === 'string') {
                links.criticProcessId = record.criticProcessId;
            }
        }
    } catch {
        return links;
    }
    return links;
}

function buildDreamPayload(proc: AIProcess): Record<string, unknown> | undefined {
    const dream = readDreamMetadata(proc);
    if (!dream) return undefined;
    const processLinks = parseDreamProcessLinks(proc);
    return {
        kind: 'dream-run',
        trigger: dream.trigger,
        provider: proc.metadata?.provider,
        model: proc.metadata?.model,
        reasoningEffort: proc.metadata?.reasoningEffort,
        timeoutMs: dream.timeoutMs,
        ...(processLinks.analyzerProcessId || processLinks.criticProcessId
            ? { processes: processLinks }
            : {}),
    };
}

export function processToHistorySummary(proc: AIProcess): HistorySummary {
    const completedAt = proc.endTime
        ? new Date(proc.endTime).getTime()
        : null;

    const displayName = proc.customTitle
        || proc.title
        || proc.promptPreview
        || proc.id;
    const dreamPayload = buildDreamPayload(proc);

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
            ...(dreamPayload ?? {}),
        },
        customTitle: proc.customTitle,
        lastMessagePreview: proc.lastMessagePreview,
        title: proc.title,
        provider: (proc.metadata?.provider === 'codex' ? 'codex' : proc.metadata?.provider === 'claude' ? 'claude' : proc.metadata?.provider === 'opencode' ? 'opencode' : 'copilot') as 'copilot' | 'codex' | 'claude' | 'opencode',
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
    const dream = readDreamMetadata(proc);
    const dreamPayload = buildDreamPayload(proc);
    return {
        id: isQueueProcessId(proc.id) ? toTaskId(proc.id) : proc.id,
        type: proc.type === 'clarification' ? 'chat' : proc.type,
        status: mapProcessStatus(proc.status) as any,
        payload: {
            kind: proc.type === 'dream-run' ? 'dream-run' : undefined,
            prompt: proc.fullPrompt,
            processId: proc.id,
            workingDirectory: proc.workingDirectory,
            workspaceId: proc.metadata?.workspaceId,
            mode: proc.metadata?.mode,
            pipelineName: proc.metadata?.pipelineName,
            workItemId: proc.metadata?.workItemId,
            provider: proc.metadata?.provider,
            ...(dreamPayload
                ? {
                    trigger: dreamPayload.trigger,
                    model: dreamPayload.model,
                    reasoningEffort: dreamPayload.reasoningEffort,
                    timeoutMs: dreamPayload.timeoutMs,
                    ...(dreamPayload.processes ? { processes: dreamPayload.processes } : {}),
                }
                : {}),
        } as any,
        displayName: proc.customTitle || proc.title || proc.promptPreview || proc.id,
        processId: proc.id,
        repoId: proc.metadata?.workspaceId,
        createdAt: proc.startTime ? new Date(proc.startTime).getTime() : Date.now(),
        startedAt: proc.startTime ? new Date(proc.startTime).getTime() : undefined,
        completedAt: proc.endTime ? new Date(proc.endTime).getTime() : undefined,
        error: proc.error,
        provider: proc.metadata?.provider,
        model: proc.metadata?.model,
        reasoningEffort: proc.metadata?.reasoningEffort,
        timeoutMs: dream
            ? dream.timeoutMs as number | undefined
            : undefined,
        config: {
            model: proc.metadata?.model as string | undefined,
            reasoningEffort: proc.metadata?.reasoningEffort as string | undefined,
            timeoutMs: dream
                ? dream.timeoutMs as number | undefined
                : undefined,
        } as any,
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
    const dream = readDreamMetadata(proc);
    const dreamPayload = buildDreamPayload(proc);
    return {
        id: isQueueProcessId(proc.id) ? toTaskId(proc.id) : proc.id,
        type: proc.type === 'clarification' ? 'chat' : proc.type,
        status: 'queued' as any,
        payload: {
            kind: proc.type === 'dream-run' ? 'dream-run' : undefined,
            prompt: proc.fullPrompt,
            processId: proc.id,
            workingDirectory: proc.workingDirectory,
            workspaceId: proc.metadata?.workspaceId,
            mode: proc.metadata?.mode,
            provider: proc.metadata?.provider,
            ...(dreamPayload
                ? {
                    trigger: dreamPayload.trigger,
                    model: dreamPayload.model,
                    reasoningEffort: dreamPayload.reasoningEffort,
                    timeoutMs: dreamPayload.timeoutMs,
                    ...(dreamPayload.processes ? { processes: dreamPayload.processes } : {}),
                }
                : {}),
        } as any,
        displayName: proc.customTitle || proc.title || proc.promptPreview || proc.id,
        processId: proc.id,
        repoId: proc.metadata?.workspaceId,
        createdAt: Date.now(),
        provider: proc.metadata?.provider,
        model: proc.metadata?.model,
        reasoningEffort: proc.metadata?.reasoningEffort,
        timeoutMs: dream
            ? dream.timeoutMs as number | undefined
            : undefined,
        config: dream
            ? {
                model: proc.metadata?.model as string | undefined,
                reasoningEffort: proc.metadata?.reasoningEffort as string | undefined,
                timeoutMs: dream.timeoutMs as number | undefined,
            } as any
            : undefined,
        customTitle: proc.customTitle,
        lastMessagePreview: proc.lastMessagePreview,
        title: proc.title,
    } as any;
}
