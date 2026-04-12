/**
 * Process History Item — canonical server-side type for history list views.
 *
 * Replaces the queue-task-shaped HistorySummary as the data contract for
 * the GET /api/workspaces/:id/history endpoint.
 */

import type { AIProcess } from '@plusplusoneplusplus/forge';

export interface ProcessHistoryItem {
    // Core identity
    id: string;
    type: string;
    status: string;

    // Display
    title: string;
    promptPreview?: string;

    // Timing (Unix ms)
    startTime: number;
    endTime?: number;

    // Error
    error?: string;

    // Metadata
    mode?: string;
    model?: string;
    workspaceId: string;
    planFilePath?: string;

    // Conversation summary
    turnCount: number;
    lastActivityAt?: number;

    // Seen state (injected by handler)
    seenAt?: string;

    // Pin & archive state
    pinnedAt?: string;
    archived?: boolean;
}

export function toProcessHistoryItem(
    proc: AIProcess,
    seenAt?: string,
): ProcessHistoryItem {
    const startTime = new Date(proc.startTime).getTime();
    const endTime = proc.endTime ? new Date(proc.endTime).getTime() : undefined;

    const turns = proc.conversationTurns ?? [];
    const lastTurn = turns[turns.length - 1];
    const lastActivityAt = lastTurn?.timestamp
        ? new Date(lastTurn.timestamp).getTime()
        : endTime;

    return {
        id: proc.id,
        type: proc.type,
        status: proc.status,
        title: proc.title || proc.promptPreview || proc.id,
        promptPreview: proc.promptPreview,
        startTime,
        endTime,
        error: proc.error,
        mode: proc.metadata?.mode as string | undefined,
        model: proc.metadata?.model as string | undefined,
        workspaceId: (proc.metadata?.workspaceId as string) ?? '',
        planFilePath: proc.metadata?.planFilePath as string | undefined,
        turnCount: turns.length,
        lastActivityAt,
        seenAt,
        pinnedAt: proc.pinnedAt,
        archived: proc.archived || undefined,
    };
}
