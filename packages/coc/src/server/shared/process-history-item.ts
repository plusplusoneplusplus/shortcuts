/**
 * Process History Item — canonical server-side type for history list views.
 *
 * Replaces the queue-task-shaped HistorySummary as the data contract for
 * the GET /api/workspaces/:id/history endpoint.
 */

import type { AIProcess } from '@plusplusoneplusplus/forge';
import { isTaskGroupRef, type ForEachContext, type MapReduceContext, type TaskGroupRef } from '../tasks/task-types';

export interface ProcessHistoryItem {
    // Core identity
    id: string;
    type: string;
    status: string;

    // Display
    title: string;
    promptPreview?: string;
    /** User-set custom title (rename UI). Orthogonal to the AI-generated `title`. */
    customTitle?: string;
    /** Denormalized cleaned snapshot of the latest user prompt (~120 chars). */
    lastMessagePreview?: string;

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
    workItemId?: string;

    // Conversation summary
    turnCount: number;
    lastActivityAt?: number;

    /**
     * Originating chat's process id when this conversation was spawned via the
     * `send_to_conversation` tool. Drives the spawned-conversation tree in the
     * chat list (forwarded verbatim from the top-level AIProcess field).
     */
    parentProcessId?: string;

    // Seen state (injected by handler)
    seenAt?: string;

    // Pin & archive state
    pinnedAt?: string;
    archived?: boolean;

    // Ralph session metadata (forwarded verbatim from proc.metadata.ralph).
    // Required for grouping completed iterations on the SPA's chat list, where
    // queue_task `payload.context.ralph` is no longer available.
    ralph?: {
        sessionId: string;
        phase?: 'grilling' | 'executing' | 'complete';
        currentIteration?: number;
        /** Confirmed goal spec, used to derive a concise chat-list title. */
        originalGoal?: string;
    };
    /** For Each generation/child metadata forwarded from proc.metadata.forEach. */
    forEach?: ForEachContext;
    /** Map Reduce map/reduce child metadata forwarded from proc.metadata.mapReduce. */
    mapReduce?: MapReduceContext;
    /** Generic task-group membership tag forwarded from proc.metadata.taskGroup. */
    taskGroup?: TaskGroupRef;
}

export function toProcessHistoryItem(
    proc: AIProcess,
    seenAt?: string,
): ProcessHistoryItem {
    const startTime = new Date(proc.startTime).getTime();
    const endTime = proc.endTime ? new Date(proc.endTime).getTime() : undefined;

    // Prefer `lastEventAt` (maintained by the store on every turn append) so this
    // mapper does not depend on conversationTurns being hydrated. The history
    // endpoint loads processes with `exclude: ['conversation']` for speed.
    const lastEventMs = proc.lastEventAt instanceof Date
        ? proc.lastEventAt.getTime()
        : (proc.lastEventAt ? new Date(proc.lastEventAt as any).getTime() : undefined);
    const turns = proc.conversationTurns ?? [];
    const lastTurn = turns[turns.length - 1];
    const lastTurnMs = lastTurn?.timestamp
        ? new Date(lastTurn.timestamp).getTime()
        : undefined;
    const lastActivityAt = lastTurnMs ?? lastEventMs ?? endTime;

    return {
        id: proc.id,
        type: proc.type,
        status: proc.status,
        title: proc.title || proc.promptPreview || proc.id,
        promptPreview: proc.promptPreview,
        customTitle: proc.customTitle,
        lastMessagePreview: proc.lastMessagePreview,
        startTime,
        endTime,
        error: proc.error,
        mode: proc.metadata?.mode as string | undefined,
        model: proc.metadata?.model as string | undefined,
        workspaceId: (proc.metadata?.workspaceId as string) ?? '',
        planFilePath: proc.metadata?.planFilePath as string | undefined,
        workItemId: proc.metadata?.workItemId as string | undefined,
        turnCount: turns.length,
        lastActivityAt,
        parentProcessId: proc.parentProcessId,
        seenAt,
        pinnedAt: proc.pinnedAt,
        archived: proc.archived || undefined,
        ralph: proc.metadata?.ralph as ProcessHistoryItem['ralph'],
        forEach: proc.metadata?.forEach as ProcessHistoryItem['forEach'],
        mapReduce: proc.metadata?.mapReduce as ProcessHistoryItem['mapReduce'],
        taskGroup: isTaskGroupRef(proc.metadata?.taskGroup) ? proc.metadata?.taskGroup : undefined,
    };
}
