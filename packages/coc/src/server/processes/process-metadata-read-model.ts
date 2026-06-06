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
