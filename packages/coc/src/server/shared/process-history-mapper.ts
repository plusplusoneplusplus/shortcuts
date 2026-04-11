/**
 * Maps AIProcess records from the process store into the HistorySummary shape
 * consumed by the SPA dashboard's history views.
 */

import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';

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
    chatMeta?: {
        turnCount: number;
        firstMessage?: string;
        lastActivityAt?: number;
        title?: string;
    };
}

export function processToHistorySummary(proc: AIProcess): HistorySummary {
    const completedAt = proc.endTime
        ? new Date(proc.endTime).getTime()
        : null;

    const displayName = proc.title
        || proc.promptPreview
        || proc.id;

    const turns = proc.conversationTurns ?? [];
    const firstUserTurn = turns.find(t => t.role === 'user');
    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined;
    const lastTurnTs = lastTurn?.timestamp ? new Date(lastTurn.timestamp).getTime() : NaN;
    const lastActivityAt = Number.isFinite(lastTurnTs)
        ? lastTurnTs
        : (completedAt ?? 0);

    const firstContent = firstUserTurn?.content ?? '';

    const chatMeta = turns.length > 0
        ? {
            turnCount: turns.length,
            firstMessage: firstUserTurn
                ? (firstContent.length > 120
                    ? firstContent.substring(0, 117) + '...'
                    : firstContent)
                : undefined,
            lastActivityAt,
            title: proc.title,
        }
        : undefined;

    return {
        id: proc.id,
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
        },
        chatMeta,
    };
}

/**
 * Reconstruct a minimal QueuedTask from a stored AIProcess so it can be
 * re-enqueued for follow-up messages after a server restart.
 */
export function processToQueuedTask(proc: AIProcess): Partial<QueuedTask> {
    return {
        id: proc.id.replace(/^queue_/, ''),
        type: proc.type === 'clarification' ? 'chat' : proc.type,
        status: 'queued' as any,
        payload: {
            prompt: proc.fullPrompt,
            processId: proc.id,
            workingDirectory: proc.workingDirectory,
            workspaceId: proc.metadata?.workspaceId,
            mode: proc.metadata?.mode,
        } as any,
        displayName: proc.title || proc.promptPreview || proc.id,
        processId: proc.id,
        repoId: proc.metadata?.workspaceId,
        createdAt: Date.now(),
    } as any;
}
