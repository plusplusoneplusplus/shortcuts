import type { AIProcess, ConversationTurn } from '@plusplusoneplusplus/forge';
import { computeConversationCostEstimate } from '@plusplusoneplusplus/forge';

export function getProcessDefaultModel(process: AIProcess): string | undefined {
    const model = process.metadata?.model
        ?? (process as AIProcess & { config?: { model?: unknown } }).config?.model;
    return typeof model === 'string' && model.trim() ? model.trim() : undefined;
}

export function buildMetadataProcess(process: AIProcess): AIProcess {
    if (!process.cumulativeTokenUsage) {
        return process;
    }
    const conversationCostEstimate = computeConversationCostEstimate(
        process.conversationTurns,
        getProcessDefaultModel(process),
    );
    return conversationCostEstimate
        ? { ...process, conversationCostEstimate }
        : process;
}

export function buildLiveConversationCostEstimate(
    process: AIProcess | undefined,
    turns: readonly ConversationTurn[] | undefined,
): AIProcess['conversationCostEstimate'] {
    if (!process?.cumulativeTokenUsage) {
        return undefined;
    }
    return computeConversationCostEstimate(
        turns,
        getProcessDefaultModel(process),
    );
}

/** Bounded read-only projection for job previews; never returns prompts or transcripts. */
export function buildJobPreviewProcess(process: AIProcess) {
    let assistant: ConversationTurn | undefined;
    for (let i = (process.conversationTurns?.length ?? 0) - 1; i >= 0; i--) {
        if (process.conversationTurns![i].role === 'assistant') { assistant = process.conversationTurns![i]; break; }
    }
    const terminal = ['completed', 'failed', 'cancelled'].includes(process.status);
    const result = terminal && typeof process.result === 'string' ? process.result.trim() : '';
    const error = process.status === 'failed' && typeof process.error === 'string' ? process.error.trim() : '';
    const progress = typeof assistant?.content === 'string' ? assistant.content.trim() : '';
    const source = result ? 'result' : error ? 'error' : progress ? 'progress' : 'empty';
    const timestamp = result || error ? process.endTime : assistant?.timestamp;
    const date = timestamp ? new Date(timestamp) : undefined;
    return {
        id: process.id, workspaceId: process.metadata?.workspaceId, type: process.type,
        status: process.status, startTime: process.startTime, promptPreview: '',
        jobPreview: { excerpt: (result || error || progress).slice(0, 800), source,
            ...(date && !Number.isNaN(date.getTime()) ? { updatedAt: date.toISOString() } : {}) },
    };
}
